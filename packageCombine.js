"use strict";
const fs = require('fs')

//Prod location 
const path = "app/server/arena/package.json"; //'./server/room/package-json/package.json'

fs.access(path, fs.F_OK, (err) => {
    if (err) {
        // console.log(err);
        console.log("No additional package.json found to merge... installing standard Arena package.json");
        //Update Local Colyseus
        var orgFile = fs.readFileSync('package.json');
        var objOrg = JSON.parse(orgFile);
        objOrg.dependencies["colyseus"]  = "file:./app/bundles/colyseus";
        objOrg.dependencies["@colyseus/core"] = "file:./app/packages/core";
        fs.writeFileSync('package.json', JSON.stringify(objOrg, null, 4));
        return;

    }
  
    console.log("Found new package json to merge");
    var orgFile = fs.readFileSync('package.json');
    var newFile = fs.readFileSync(path);

    // console.log(dst.toString());

    MergeFile(orgFile, newFile);
    // Create a new `package.json`
    // console.log(merge(dst, src));
});

const pathNPM = "app/server/arena/.npmrc";

fs.access(pathNPM, fs.F_OK, (err) => {
    if (err) {
        // console.log(err);
        // console.log("No .npmrc file found for deployment");
        return;
    }
  
    console.log("Found custom .npmrc, using for npm install.");
    var npmrcFile = fs.readFileSync(pathNPM);
    fs.writeFileSync('.npmrc', npmrcFile);

});

function MergeFile(orgFile, newFile) {
    try {
        let objOrg = JSON.parse(orgFile);
        let objNew = JSON.parse(newFile);

        let orgDependencies = objOrg.dependencies;
        let dependencies = objNew.dependencies;

        console.log("Adding Dependencies");
        console.log(dependencies);

        let result = {};
        let key;
        for (key in orgDependencies) {
            if(orgDependencies.hasOwnProperty(key)) {
                result[key] = orgDependencies[key];
            }
        }

        for (key in dependencies) {
            if(dependencies.hasOwnProperty(key)) {
                if(key.includes("colyseus/core") || key.includes("colyseus/drivers") || key.includes("colyseus/presence") || key.includes("colyseus/transport") ||
                    key.includes("colyseus/monitor") || key.includes("colyseus/arena") || key == "'colyseus'" || key == "colyseus" || key.includes("colyseus/schema")) {
                    console.log("Skipping item: "+key+" - cannot be updated on package.json.")
                } else {
                    result[key] = dependencies[key];
                }
            }
        }

        //Override any Colyseus update
        result["colyseus"] = "file:./app/bundles/colyseus";
        result["@colyseus/core"] = "file:./app/packages/core";

        objOrg.dependencies = result;

        //Copy workspace
        let orgWorkspaces = objOrg.workspaces;
        let newWorkspaces = objNew.workspaces;
        let workspaceNew = [];
        
        if(newWorkspaces !== undefined) {
            console.log("Adding New Workspaces");
            for (let ii = 0; ii < newWorkspaces.length; ii++) {
                const element = newWorkspaces[ii];
                workspaceNew.push("app/server/arena/"+element);              
            }
        }
       
        if(orgWorkspaces === undefined) {
            objOrg["workspaces"] = workspaceNew;
        } else {
            objOrg["workspaces"] = orgWorkspaces.concat(workspaceNew);
        }
        
        // console.log("Merged results")
        // console.log(result);

        fs.writeFileSync('package.json', JSON.stringify(objOrg, null, 4));
        console.log("New Package JSON merge completed");


    } catch (error) {
        //Update Local Colyseus
        var orgFile = fs.readFileSync('package.json');
        var objOrg = JSON.parse(orgFile);
        objOrg.dependencies["colyseus"]  = "file:./app/bundles/colyseus";
        objOrg.dependencies["@colyseus/core"] = "file:./app/packages/core";
        fs.writeFileSync('package.json', JSON.stringify(objOrg, null, 4));

        console.error("Failed to parse Package");
        console.error(error);
    }
    

}