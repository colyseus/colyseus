const { execSync } = require('child_process');
const getPackages = require('get-monorepo-packages');
const semver = require('semver');


function publishVersionChangedPackagesList(root_dir) {
    // Get package list in a directory.
    const packagesList = getPackages(root_dir);
    for (let index in packagesList) {
        try {
            const packageInfo = packagesList[index];
            // Get published package latest version.
            const latestPublisedVersion = execSync(`npm show ${packageInfo['package']['name']} version`).toString().replace(/\n/g, "");
            console.log(`Package ${packageInfo['package']['name']} latest version in npm registry: ${latestPublisedVersion}`);
            console.log(`Package ${packageInfo['package']['name']} version in repository: ${packageInfo["package"]["version"]}`);
            // Skip private packages
            if (packageInfo["package"].hasOwnProperty("private") || packageInfo["package"]["private"]) {
                console.log(`Skipping private package ${packageInfo["package"]["name"]}`);
                continue;
            }
            // Check whether the directory packge is greater than the published.
            else if (semver.gt(packageInfo["package"]["version"], latestPublisedVersion)) {
                // Set NPM tokens.
                execSync(`npm config set //registry.npmjs.org/:_authToken ${process.env.NPM_TOKEN}`,
                    { stdio: 'inherit' })
                console.log(`publishing package ${packageInfo["package"]["name"]}`)
                // Execute NPM commands
                execSync(`cd ${packageInfo["location"]} && npm publish`, { stdio: 'inherit' });
            }
        } catch (error) {
            continue;
        }
    }
}

publishVersionChangedPackagesList("./");
