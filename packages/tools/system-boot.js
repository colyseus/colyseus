#!/usr/bin/env node

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Apply PM2 monkey-patch for custom functionality (e.g., updateProcessConfig)
 * This patches the globally installed PM2 used by the system.
 *
 * Strategy: Rename ActionMethods.js -> ActionMethods_orig.js and replace with
 * our wrapper that imports the original and adds custom methods.
 */
function applyPM2Patches() {
  try {
    // Find global PM2 installation
    const globalPM2Path = execSync('npm root -g', { encoding: 'utf8' }).trim() + '/pm2';

    if (!fs.existsSync(globalPM2Path)) {
      console.log('[PM2 Patch] Global PM2 not found, skipping...');
      return;
    }

    const godPath = path.join(globalPM2Path, 'lib/God');
    const actionMethodsPath = path.join(godPath, 'ActionMethods.js');
    const actionMethodsOrigPath = path.join(godPath, 'ActionMethods_orig.js');
    const ourActionMethodsPath = path.join(__dirname, 'pm2', 'ActionMethods.js');

    // Check if our patch file exists
    if (!fs.existsSync(ourActionMethodsPath)) {
      console.log('[PM2 Patch] Custom ActionMethods.js not found, skipping...');
      return;
    }

    // Check if already patched (ActionMethods_orig.js exists)
    if (!fs.existsSync(actionMethodsOrigPath)) {
      // Rename original ActionMethods.js -> ActionMethods_orig.js
      console.log('[PM2 Patch] Renaming original ActionMethods.js -> ActionMethods_orig.js');
      fs.renameSync(actionMethodsPath, actionMethodsOrigPath);

    } else {
      console.log('[PM2 Patch] Already patched, skipping...');
    }

    // Copy our ActionMethods.js wrapper
    console.log(`[PM2 Patch] Installing custom ActionMethods.js wrapper (${actionMethodsPath})`);
    fs.copyFileSync(ourActionMethodsPath, actionMethodsPath);

    // Patch Daemon.js to expose "updateProcessConfig" method
    const daemonPath = path.join(globalPM2Path, 'lib/Daemon.js');
    console.log(`[PM2 Patch] Patching Daemon.js to expose updateProcessConfig (${daemonPath})`);
    if (fs.existsSync(daemonPath)) {
      let daemonContent = fs.readFileSync(daemonPath, 'utf8');

      // Check if updateProcessConfig is already exposed
      if (!daemonContent.includes('updateProcessConfig')) {
        // Find server.expose({ and add updateProcessConfig after it
        const exposePattern = 'server.expose({';
        const exposeIndex = daemonContent.indexOf(exposePattern);

        if (exposeIndex !== -1) {
          const insertPos = exposeIndex + exposePattern.length;
          daemonContent = daemonContent.slice(0, insertPos) +
            '\n    updateProcessConfig     : God.updateProcessConfig,' +
            daemonContent.slice(insertPos);
          fs.writeFileSync(daemonPath, daemonContent);
          console.log(`[PM2 Patch] Daemon.js patched successfully.`);
        } else {
          console.warn('[PM2 Patch] Could not find server.expose pattern in Daemon.js');
        }
      } else {
        console.log('[PM2 Patch] Daemon.js already has updateProcessConfig exposed.');
      }
    } else {
      console.warn('[PM2 Patch] Daemon.js not found at', daemonPath);
    }

    console.log('[PM2 Patch] PM2 patches applied successfully.');

  } catch (error) {
    console.warn('[PM2 Patch] Failed to apply PM2 patches:', error.message);
    // Don't exit - patches are optional enhancements
  }
}

const NGINX_LIMITS_CONFIG_FILE = '/etc/nginx/colyseus_limits.conf';
const LIMITS_CONF_FILE = '/etc/security/limits.d/colyseus.conf';
const SYSCTL_FILE = '/etc/sysctl.d/local.conf';

const MAX_CCU_PER_CPU = 5000;

/**
 * System-wide limits configuration for high-CCU environments
 * @param {Object} options
 * @param {number} options.maxCCUPerCPU - Maximum concurrent users per CPU core
 * @param {number} options.connectionsMultiplier - Multiplier for worker connections (default: 2)
 * @param {number} options.fileDescriptorMultiplier - Multiplier for max file descriptors (default: 6)
 */
function configureSystemLimits(options = {}) {
  const {
    connectionsMultiplier = 2,
    fileDescriptorMultiplier = 6
  } = options;

  const numCPU = os.cpus().length;
  const maxCCU = numCPU * MAX_CCU_PER_CPU;

  // Calculate limits
  const workerConnections = Math.min(maxCCU * connectionsMultiplier, 65535); // Cap at max_socket_backlog (65535)
  let maxFileDescriptors = maxCCU * fileDescriptorMultiplier;
  const workerRlimitNofile = Math.ceil(workerConnections * 3.5); // Assume 3.5 file descriptors per connection for safety

  // Calculate total file descriptors needed
  const totalFileDescriptors = workerRlimitNofile * numCPU;

  if (totalFileDescriptors > maxFileDescriptors) {
    console.warn(`Warning: Total file descriptors (${totalFileDescriptors}) exceeds maxFileDescriptors (${maxFileDescriptors}). Increasing maxFileDescriptors.`);
    maxFileDescriptors = totalFileDescriptors * 1.5; // 50% safety margin
  }

  // Check memory (rough estimate: 150 KB per connection)
  const estimatedMemoryMB = (workerConnections * numCPU * 150) / 1024;
  const totalMemoryMB = Number(execSync('free -m | awk \'/Mem:/ {print $2}\'').toString().trim());
  if (estimatedMemoryMB > totalMemoryMB * 0.8) {
    console.warn(`Warning: Estimated memory usage (${estimatedMemoryMB} MB) exceeds 80% of available memory (${totalMemoryMB} MB). Consider reducing MAX_CCU_PER_CPU.`);
  }

  if (process.argv.includes('--dry-run')) {
    console.log({
      numCPU,
      maxCCU,
      workerConnections,
      maxFileDescriptors,
      workerRlimitNofile,
      totalFileDescriptors,
      estimatedMemoryMB
    });
    process.exit();
  }

  // Configuration updates
  try {
    // Update Nginx limits
    fs.writeFileSync(NGINX_LIMITS_CONFIG_FILE, `
worker_rlimit_nofile ${workerRlimitNofile};
events {
    use epoll;
    worker_connections ${workerConnections};
    multi_accept on;
}
`);

    // Update system-wide limits
    fs.writeFileSync(LIMITS_CONF_FILE, `
# System-wide file descriptor limits
* - nofile ${maxFileDescriptors}
nginx soft nofile ${maxFileDescriptors}
nginx hard nofile ${maxFileDescriptors}
`);

    // Update sysctl
    fs.writeFileSync(SYSCTL_FILE, `
# System-wide file descriptor limit
fs.file-max = ${maxFileDescriptors * 2}

# TCP buffer optimization
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 87380 16777216

# Connection handling optimization
net.core.netdev_max_backlog = 50000
net.core.somaxconn = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535

# TCP timeout optimization
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 30
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 3
`);

    // Apply sysctl changes
    execSync('sysctl -p', { stdio: 'inherit' });

    // Reload systemd
    execSync('systemctl daemon-reload', { stdio: 'inherit' });

    console.log(`System limits configured successfully for ${maxCCU} CCU (${MAX_CCU_PER_CPU}/CPU)`);

  } catch (error) {
    console.error('Failed to update system limits:', error);
    process.exit(1);
  }
}

// Apply PM2 patches before configuring system limits
applyPM2Patches();

configureSystemLimits();