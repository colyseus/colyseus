import { RoomListingData } from "@colyseus/core"
import mongoose, { Document, Schema } from 'mongoose';

let currentDay: number = 0;
let totalCCU: number = 0;
let peakCCUHour: number[] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
let peakCCUDay: number = 0;
let avgCCUDay: number = 0;

const MY_POD_NAME = process.env.MY_POD_NAME || "devpod";

let globalCCUCounter;
let totalRoomCounter;
let lockedRoomCounter;

let globalCCUCounterLocal: number = 0;

export function setPrometheusCounters (global, totalRooms, lockedRooms) {
    globalCCUCounter = global;
    totalRoomCounter = totalRooms;
    lockedRoomCounter = lockedRooms;

    globalCCUCounter.inc();
    globalCCUCounter.dec();

    totalRoomCounter.inc();
    totalRoomCounter.dec();

    lockedRoomCounter.inc();
    lockedRoomCounter.dec();
}

export async function updateLockRoomStatsCount(increment : boolean) {
    if(increment) {
        if(lockedRoomCounter) lockedRoomCounter.inc();
    } else {
        if(lockedRoomCounter) lockedRoomCounter.dec();
    }
}

export async function updateTotalRoomStatsCount(increment : boolean) {
    if(increment) {
        if(totalRoomCounter) totalRoomCounter.inc();
    } else {
        if(totalRoomCounter) totalRoomCounter.dec();
    }
}


export async function incrementClientStatsCount(listing: RoomListingData) {
    globalCCUCounterLocal++;
    if(globalCCUCounter) {
        globalCCUCounter.inc();
    }
  
    // ProcessData(true);
    // let currentAPIKey = mongoose.connection.db.databaseName;
    // let updateStats = await mongoose.connection.useDb("stats").collection("api-level").findOneAndUpdate(
    //     { apikey : currentAPIKey }, 
    //     { 
    //         $set : { apikey : currentAPIKey, timestamp: Date.now() }, 
    //         $inc: { clients: 1}
    //     },
    //     { upsert: true}
    // );

    // let updateServerLevel = await mongoose.connection.useDb("stats").collection("server-level").findOneAndUpdate(
    //     { apikey : currentAPIKey, server : MY_POD_NAME }, 
    //     { 
    //         $set : { 
    //             apikey : currentAPIKey, 
    //             server : MY_POD_NAME,
    //             clients: totalCCU,
    //             peakCCUDay : peakCCUDay,
    //             avgCCUDay: avgCCUDay,
    //             peakCCUHour: peakCCUHour,
    //             timestamp: Date.now()
    //         }, 
    //     },
    //     { upsert: true}
    // );

}

export async function decrementClientCount(listing: RoomListingData, isDisconnecting: boolean = false) {
    if(globalCCUCounterLocal == 0) return;
    globalCCUCounterLocal--;
    if(globalCCUCounter) globalCCUCounter.dec();

    // ProcessData(false);
    // let currentAPIKey = mongoose.connection.db.databaseName;
    // let updateStats = await mongoose.connection.useDb("stats").collection("api-level").findOneAndUpdate(
    //     { apikey : currentAPIKey, clients : { $gt : 0 } }, 
    //     { 
    //         $set : { apikey : currentAPIKey, timestamp: Date.now() }, 
    //         $inc: { clients: -1}  
    //     },
    //     { upsert: true}
    // );

    // let updateServerLevel = await mongoose.connection.useDb("stats").collection("server-level").findOneAndUpdate(
    //     { apikey : currentAPIKey, server : MY_POD_NAME }, 
    //     { 
    //         $set : { 
    //             apikey : currentAPIKey, 
    //             server : MY_POD_NAME,
    //             clients: totalCCU,
    //             peakCCUDay : peakCCUDay,
    //             avgCCUDay: avgCCUDay,
    //             peakCCUHour: peakCCUHour,
    //             timestamp: Date.now()
    //         }, 
    //     },
    //     { upsert: true}
    // );
}

const reducer = (accumulator, currentValue) => accumulator + currentValue;

function ProcessData(inc: boolean) {
    let dateObj = new Date();
    let day = dateObj.getUTCDate();
    let hour = dateObj.getHours();
    if(currentDay != day) {
        totalCCU = 0;
        peakCCUHour = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
        peakCCUDay = 0;
        avgCCUDay = 0;
        currentDay = day;
    }
    totalCCU += ((inc) ? 1 : -1);
    peakCCUHour[hour] = (peakCCUHour[hour] < totalCCU) ? totalCCU : peakCCUHour[hour];
    peakCCUDay = (peakCCUDay < totalCCU) ? totalCCU : peakCCUDay;
    avgCCUDay = peakCCUHour.reduce(reducer) / peakCCUHour.length;
}