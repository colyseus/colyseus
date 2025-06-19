import * as Benchmark from "benchmark";
import * as notepack from "notepack.io";
import * as msgpackLite from "msgpack-lite";
import * as fossilDelta from "fossil-delta";

let data1 = { 
    one: 1,
    two: "two",
    list: [1,2,3,4,5,6,7,8,9],
    map: {
        "1982739173": { x: 0, y: 100 },
        "1982739174": { x: 10, y: 200 },
        "1982739175": { x: 20, y: 300 },
        "1982739176": { x: 30, y: 400 },
        "1982739177": { x: 40, y: 500 },
        "1982739178": { x: 50, y: 600 },
        "1982739179": { x: 60, y: 700 },
        "1982739180": { x: 70, y: 800 },
        "1982739181": { x: 80, y: 900 },
        "1982739182": { x: 90, y: 1000 },
        "1982739183": { x: 100, y: 1100 },
    }
}

let data2 = { 
    two: "two 2",
    list: [1,2,3,4,5,6,7,8,9],
    map: {
        "1982739173": { x: 0, y: 100 },
        "1982739174": { x: 10, y: 200 },
        "1982739175": { x: 20, y: 300 },
        "1982739176": { x: 30, y: 400 },
        "1982739177": { x: 50, y: 500 },
        "1982739179": { x: 60, y: 700 },
        "1982739180": { x: 70, y: 800 },
        "1982739181": { x: 80, y: 900 },
        "1982739182": { x: 90, y: 1000 },
        "1982739183": { x: 100, y: 1100 },
        "1982739184": { x: 110, y: 1200 },
    }
}

let notepackDelta = fossilDelta.create(notepack.encode(data1), notepack.encode(data2));
let msgpackLiteDelta = fossilDelta.create(msgpackLite.encode(data1), msgpackLite.encode(data2));

let data1Encoded = msgpackLite.encode(data1)
let packed1 = notepack.encode(data1);

let suite = new Benchmark.Suite();
suite.add("notepack", () => {
    notepack.decode(data1Encoded);;
    new Uint8Array(fossilDelta.apply(packed1, notepackDelta));
});

suite.add("msgpack-lite", () => {
    msgpackLite.decode(data1Encoded);
    fossilDelta.apply(packed1, msgpackLiteDelta);
});

suite.on('cycle', (e) => console.log(String(e.target)));

console.log("Start...");
suite.run();