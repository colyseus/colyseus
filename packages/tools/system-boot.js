#!/usr/bin/env node

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

const NGINX_LIMITS_CONFIG_FILE = '/etc/nginx/colyseus_limits.conf';
const LIMITS_CONF_FILE = '/etc/security/limits.d/colyseus.conf';
const SYSCTL_FILE = '/etc/sysctl.d/local.conf'

const MAX_CCU_PER_CPU = 8000;

/**
 * System-wide limits configuration for high-CCU environments
 * @param {Object} options
 * @param {number} options.maxCCUPerCPU - Maximum concurrent users per CPU core
 * @param {number} options.connectionsMultiplier - Multiplier for worker connections (default: 3)
 * @param {number} options.fileDescriptorMultiplier - Multiplier for max file descriptors (default: 4)
 */
function configureSystemLimits(options = {}) {
  const {
    connectionsMultiplier = 3,
    fileDescriptorMultiplier = 4
  } = options;

  const numCPU = os.cpus().length;
  const maxCCU = numCPU * MAX_CCU_PER_CPU;

  // Calculate limits
  const workerConnections = maxCCU * connectionsMultiplier;
  const maxFileDescriptors = maxCCU * fileDescriptorMultiplier;

  // Nginx-specific calculations
  const workerRlimitNofile = (workerConnections / numCPU) * 2;

  // Validation checks
  if (workerConnections > 65535) {
    console.warn(`Warning: worker_connections (${workerConnections}) exceeds typical max_socket_backlog (65535)`);
  }

  if (maxFileDescriptors > 1048576) {
    console.warn(`Warning: Very high file descriptor limit (${maxFileDescriptors}). Verify system capabilities.`);
  }

  if (process.argv.includes('--dry-run')) {
    console.log({
      maxCCU,
      workerConnections,
      maxFileDescriptors,
      workerRlimitNofile
    })
    process.exit();
  }

  // Configuration updates
  try {
    // Update Nginx limits
    if (fs.existsSync(NGINX_LIMITS_CONFIG_FILE)) {
      fs.writeFileSync(NGINX_LIMITS_CONFIG_FILE, `
worker_rlimit_nofile ${workerRlimitNofile};
events {
    use epoll;
    worker_connections ${workerConnections};
    multi_accept on;
}
`);
    }

    // Update system-wide limits
    fs.writeFileSync(LIMITS_CONF_FILE, `
# System-wide file descriptor limits
* - nofile ${maxFileDescriptors}
nginx soft nofile ${maxFileDescriptors}
nginx hard nofile ${maxFileDescriptors}
`);

    // Update sysctl with doubled file-max for safety margin
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
    execSync("sysctl -p", { stdio: 'inherit' });
    console.log(`System limits configured successfully for ${maxCCU} CCU (${MAX_CCU_PER_CPU}/CPU)`);

  } catch (error) {
    console.error('Failed to update system limits:', error);
    process.exit(1);
  }
}

configureSystemLimits();