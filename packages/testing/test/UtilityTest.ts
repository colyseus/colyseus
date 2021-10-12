import {HybridArray} from "@colyseus/core/src/Utils";
import assert from "assert";

const idGen = () => {
    return (Math.random() + 1).toString(36).substring(7);
}

class Sample {
    sessionId: string;
    foo: string;

    constructor(arg1: string) {
        this.sessionId = idGen();
        this.foo = arg1;
    }
}

describe("@colyseus/utility/testing", () => {
    const UNIQUE_ID = "sessionId";
    let hybridArray: HybridArray<Sample>;

    const sample1 = new Sample("bar1");
    const sample2 = new Sample("bar2");
    const sample3 = new Sample("bar3");

    before(() => hybridArray = new HybridArray<Sample>(UNIQUE_ID, [sample1, sample2, sample3]));

    it("should contain all sample objects in the hybrid array.", () => {
        assert.strictEqual(3, hybridArray.length);
    })

    it("should be able to get object by it's key after adding new object.", () => {
        const newSample = new Sample("bar4");
        hybridArray.add(newSample);
        assert.strictEqual(newSample, hybridArray.get(newSample[UNIQUE_ID]));
    })

    it("should be able to get object by it's index after adding new object.", () => {
        const newSample = new Sample("bar5");
        hybridArray.add(newSample);
        assert.strictEqual(newSample, hybridArray.at(hybridArray.indexOf(newSample)));
    })

    it("should remove object by key successfully", () => {
        const lengthBeforeRemoving = hybridArray.length;
        const removed = hybridArray.removeByKey(sample1.sessionId);
        assert.strictEqual(sample1, removed);
        assert.strictEqual(hybridArray.length, lengthBeforeRemoving - 1 );
        assert.strictEqual(hybridArray.get(sample1.sessionId), undefined);
        assert.strictEqual(hybridArray.indexOf(removed), -1);
    })

    it("should remove object by index successfully", () => {
        const index = hybridArray.indexOf(sample2);
        const lengthBeforeRemoving = hybridArray.length;
        const removed = hybridArray.removeByIndex(index);
        assert.strictEqual(sample2, removed);
        assert.strictEqual(hybridArray.length, lengthBeforeRemoving - 1 );
        assert.strictEqual(hybridArray.get(sample2.sessionId), undefined);
        assert.strictEqual(hybridArray.indexOf(removed), -1);
    })

    it("should remove object by object itself successfully", () => {
        const lengthBeforeRemoving = hybridArray.length;
        const removed = hybridArray.removeByObject(sample3);
        assert.strictEqual(sample3, removed);
        assert.strictEqual(hybridArray.length, lengthBeforeRemoving - 1 );
        assert.strictEqual(hybridArray.get(sample3.sessionId), undefined);
        assert.strictEqual(hybridArray.indexOf(removed), -1);
    })
});
