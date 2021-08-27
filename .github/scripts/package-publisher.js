const { execSync } = require('child_process');
const getPackages = require('get-monorepo-packages');
const npmview = require('npmview');
const semver = require('semver');


function publishVersionChangedPackagesList(root_dir) {
    // Get package list in a directory.
    const packages = getPackages(root_dir);
    for (index in packages) {
        const package = packages[index];
        // Get published package info and latest version.
        npmview(package["package"]["name"], function (err, version, moduleInfo) {
            if (err) {
                console.log(err);
                throw err;
            } else {
                // Check whether the directory packge is greater than the published.
                if (semver.gt(package["package"]["version"], version)) {
                    // Set NPM tokens.
                    execSync(`npm config set //registry.npmjs.org/:_authToken ${process.env.NPM_TOKEN}`,
                        { stdio: 'inherit' })
                    // Execute NPM commands
                    execSync(`cd ${package["location"]} && npm publish`, { stdio: 'inherit' });
                }
            }
        })
    }
}

publishVersionChangedPackagesList("./");
