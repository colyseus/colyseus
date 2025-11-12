import { Presence } from './Presence.js';

type Callback = (...args: any[]) => void;

/**
 * ScopedPresence wraps a global Presence instance and provides room-scoped subscriptions
 * that are automatically cleaned up when the room is disposed.
 */
export class ScopedPresence implements Presence {
    private subscriptions: Map<string, Set<Callback>> = new Map();

    constructor(private presence: Presence) {}

    /**
     * Subscribes to the given topic. The callback will be triggered whenever a message is published on topic.
     * This subscription is tracked and will be automatically unsubscribed when dispose() is called.
     */
    public async subscribe(topic: string, callback: Callback) {
        // Track this subscription
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, new Set());
        }
        this.subscriptions.get(topic)!.add(callback);

        // Delegate to the global presence
        await this.presence.subscribe(topic, callback);
        return this;
    }

    /**
     * Unsubscribe from given topic.
     */
    public async unsubscribe(topic: string, callback?: Callback) {
        if (callback) {
            // Remove specific callback from tracking
            const callbacks = this.subscriptions.get(topic);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this.subscriptions.delete(topic);
                }
            }
        } else {
            // Remove all callbacks for this topic from tracking
            this.subscriptions.delete(topic);
        }

        // Delegate to the global presence
        await this.presence.unsubscribe(topic, callback);
        return this;
    }

    /**
     * Dispose all subscriptions created through this scoped presence.
     * This should be called when the room is disposed.
     */
    public async dispose() {
        // Unsubscribe from all tracked subscriptions
        const unsubscribePromises: Promise<any>[] = [];
        
        for (const [topic, callbacks] of this.subscriptions.entries()) {
            for (const callback of callbacks) {
                unsubscribePromises.push(this.presence.unsubscribe(topic, callback));
            }
        }
        
        // Clear the subscriptions map
        this.subscriptions.clear();
        
        // Wait for all unsubscribe operations to complete
        await Promise.all(unsubscribePromises);
    }

    /**
     * Posts a message to given topic.
     */
    public async publish(topic: string, data: any) {
        return await this.presence.publish(topic, data);
    }

    /**
     * Returns if key exists.
     */
    public async exists(key: string): Promise<boolean> {
        return await this.presence.exists(key);
    }

    /**
     * Set key to hold the string value.
     */
    public async set(key: string, value: string) {
        return await this.presence.set(key, value);
    }

    /**
     * Set key to hold the string value and set key to timeout after a given number of seconds.
     */
    public async setex(key: string, value: string, seconds: number) {
        return await this.presence.setex(key, value, seconds);
    }

    /**
     * Expire the key in seconds.
     */
    public async expire(key: string, seconds: number) {
        return await this.presence.expire(key, seconds);
    }

    /**
     * Get the value of key.
     */
    public async get(key: string) {
        return await this.presence.get(key);
    }

    /**
     * Removes the specified key.
     */
    public async del(key: string) {
        return await this.presence.del(key);
    }

    /**
     * Add the specified members to the set stored at key.
     */
    public async sadd(key: string, value: any) {
        return await this.presence.sadd(key, value);
    }

    /**
     * Returns all the members of the set value stored at key.
     */
    public async smembers(key: string): Promise<string[]> {
        return await this.presence.smembers(key);
    }

    /**
     * Returns if member is a member of the set stored at key.
     */
    public async sismember(key: string, field: string): Promise<number> {
        return await this.presence.sismember(key, field);
    }

    /**
     * Remove the specified members from the set stored at key.
     */
    public async srem(key: string, value: any) {
        return await this.presence.srem(key, value);
    }

    /**
     * Returns the set cardinality (number of elements) of the set stored at key.
     */
    public async scard(key: string): Promise<number> {
        return await this.presence.scard(key);
    }

    /**
     * Returns the members of the set resulting from the intersection of all the given sets.
     */
    public async sinter(...keys: string[]): Promise<string[]> {
        return await this.presence.sinter(...keys);
    }

    /**
     * Sets field in the hash stored at key to value.
     */
    public async hset(key: string, field: string, value: string) {
        return await this.presence.hset(key, field, value);
    }

    /**
     * Increments the number stored at field in the hash stored at key by increment.
     */
    public async hincrby(key: string, field: string, value: number): Promise<number> {
        return await this.presence.hincrby(key, field, value);
    }

    /**
     * WARNING: DO NOT USE THIS METHOD. It is meant for internal use only.
     * @private
     */
    public async hincrbyex(key: string, field: string, value: number, expireInSeconds: number): Promise<number> {
        return await this.presence.hincrbyex(key, field, value, expireInSeconds);
    }

    /**
     * Returns the value associated with field in the hash stored at key.
     */
    public async hget(key: string, field: string) {
        return await this.presence.hget(key, field);
    }

    /**
     * Returns all fields and values of the hash stored at key.
     */
    public async hgetall(key: string): Promise<{ [field: string]: string }> {
        return await this.presence.hgetall(key);
    }

    /**
     * Removes the specified fields from the hash stored at key.
     */
    public async hdel(key: string, field: string): Promise<boolean> {
        return await this.presence.hdel(key, field);
    }

    /**
     * Returns the number of fields contained in the hash stored at key.
     */
    public async hlen(key: string): Promise<number> {
        return await this.presence.hlen(key);
    }

    /**
     * Increments the number stored at key by one.
     */
    public async incr(key: string): Promise<number> {
        return await this.presence.incr(key);
    }

    /**
     * Decrements the number stored at key by one.
     */
    public async decr(key: string): Promise<number> {
        return await this.presence.decr(key);
    }

    /**
     * Returns the length of the list stored at key.
     */
    public async llen(key: string): Promise<number> {
        return await this.presence.llen(key);
    }

    /**
     * Adds the string value to the end of the list stored at key.
     */
    public async rpush(key: string, value: string): Promise<number> {
        return await this.presence.rpush(key, value);
    }

    /**
     * Adds the string value to the beginning of the list stored at key.
     */
    public async lpush(key: string, value: string): Promise<number> {
        return await this.presence.lpush(key, value);
    }

    /**
     * Removes and returns the last element of the list stored at key.
     */
    public async rpop(key: string): Promise<string> {
        return await this.presence.rpop(key);
    }

    /**
     * Removes and returns the first element of the list stored at key.
     */
    public async lpop(key: string): Promise<string> {
        return await this.presence.lpop(key);
    }

    /**
     * Removes and returns the last element of the list stored at key. If the list is empty, the execution is halted until an element is available or the timeout is reached.
     */
    public async brpop(...args: [...keys: string[], timeoutInSeconds: number]): Promise<[string, string] | null> {
        return await this.presence.brpop(...args);
    }

    /**
     * Set the maximum number of listeners that can be attached to the emitter.
     */
    public setMaxListeners(n: number) {
        if (typeof this.presence.setMaxListeners === 'function') {
            this.presence.setMaxListeners(n);
        }
    }

    /**
     * Shutdown the presence instance.
     */
    public shutdown() {
        if (typeof this.presence.shutdown === 'function') {
            this.presence.shutdown();
        }
    }
}
