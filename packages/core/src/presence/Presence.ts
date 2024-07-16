/**
 * When you need to scale your server on multiple processes and/or machines, you'd need to provide
 * the Presence option to the Server. The purpose of Presence is to allow communicating and
 * sharing data between different processes, specially during match-making.
 *
 * - Local presence - This is the default option. It's meant to be used when you're running Colyseus in
 *  a single process.
 * - Redis presence - Use this option when you're running Colyseus on multiple processes and/or machines.
 *
 * @default Local presence
 */
export interface Presence {
    /**
     * Subscribes to the given topic. The callback will be triggered whenever a message is published on topic.
     *
     * @param topic - Topic name.
     * @param callback - Callback to trigger on subscribing.
     */
    subscribe(topic: string, callback: Function);

    /**
     * Unsubscribe from given topic.
     *
     * @param topic - Topic name.
     * @param callback - Callback to trigger on topic unsubscribing.
     */
    unsubscribe(topic: string, callback?: Function);

    /**
     * Posts a message to given topic.
     *
     * @param topic - Topic name.
     * @param data - Message body/object.
     */
    publish(topic: string, data: any);

    /**
     * Returns if key exists.
     *
     * @param key
     */
    exists(key: string): Promise<boolean>;

    /**
     * Set key to hold the string value.
     *
     * @param key - Identifier.
     * @param value - Message body/object.
     */
    set(key: string, value: string);

    /**
     * Set key to hold the string value and set key to timeout after a given number of seconds.
     *
     * @param key - Identifier.
     * @param value - Message body/object.
     * @param seconds - Timeout value.
     */
    setex(key: string, value: string, seconds: number);

    /**
     * Get the value of key.
     *
     * @param key - Identifier.
     */
    get(key: string);

    /**
     * Removes the specified key.
     *
     * @param key - Identifier of the object to removed.
     */
    del(key: string): void;

    /**
     * Add the specified members to the set stored at key. Specified members that are already
     * a member of this set are ignored. If key does not exist, a new set is created before
     * adding the specified members.
     *
     * @param key - Name/Identifier of the set.
     * @param value - Message body/object.
     */
    sadd(key: string, value: any);
    /**
     * Returns all the members of the set value stored at key.
     *
     * @param key - Name/Identifier of the set.
     */
    smembers(key: string): Promise<string[]>;
    /**
     * Returns if member is a member of the set stored at key.
     *
     * @param key - Name/Identifier of the set.
     * @param field - Key value within the set.
     * @returns `1` if the element is a member of the set else `0`.
     */
    sismember(key: string, field: string);
    /**
     * Remove the specified members from the set stored at key. Specified members that are not a
     * member of this set are ignored. If key does not exist, it is treated as an empty set
     * and this command returns 0.
     *
     * @param key -  Name/Identifier of the set.
     * @param value - Key value within the set.
     */
    srem(key: string, value: any);
    /**
     * Returns the set cardinality (number of elements) of the set stored at key.
     *
     * @param key -  Name/Identifier of the set.
     */
    scard(key: string);
    /**
     * Returns the members of the set resulting from the intersection of all the given sets.
     *
     * @param keys - Key values within the set.
     */
    sinter(...keys: string[]): Promise<string[]>;

    /**
     * Sets field in the hash stored at key to value. If key does not exist, a new key holding a hash is created.
     * If field already exists in the hash, it is overwritten.
     */
    hset(key: string, field: string, value: string);

    /**
     * Increments the number stored at field in the hash stored at key by increment. If key does not exist, a new key
     * holding a hash is created. If field does not exist the value is set to 0 before the operation is performed.
     */
    hincrby(key: string, field: string, value: number): number | Promise<number>;

    /**
     * Returns the value associated with field in the hash stored at key.
     */
    hget(key: string, field: string): Promise<string>;

    /**
     * Returns all fields and values of the hash stored at key.
     */
    hgetall(key: string): Promise<{ [key: string]: string }>;

    /**
     * Removes the specified fields from the hash stored at key. Specified fields that do not exist within
     * this hash are ignored. If key does not exist, it is treated as an empty hash and this command returns 0.
     */
    hdel(key: string, field: string): boolean | Promise<boolean>;

    /**
     * Returns the number of fields contained in the hash stored at key
     */
    hlen(key: string): Promise<number>;

    /**
     * Increments the number stored at key by one. If the key does not exist, it is set to 0 before performing
     * the operation. An error is returned if the key contains a value of the wrong type or
     * contains a string that can not be represented as integer. This operation is limited to 64-bit signed integers.
     */
    incr(key: string): Promise<number>;

    /**
     * Decrements the number stored at key by one. If the key does not exist, it is set to 0 before performing
     * the operation. An error is returned if the key contains a value of the wrong type or contains a string
     * that can not be represented as integer. This operation is limited to 64-bit signed integers.
     */
    decr(key: string): Promise<number>;

    shutdown(): void;
}
