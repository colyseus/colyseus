import { RedisClient } from "redis";

let redisClient: RedisClient;

export function setRedisClient(client?: RedisClient) {
  redisClient = client;
}

export function getRedisClient() {
  return redisClient;
}
