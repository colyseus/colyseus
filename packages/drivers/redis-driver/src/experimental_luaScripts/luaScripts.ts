/**
 * Lua scripts for Redis-based room cache filtering and sorting.
 * These scripts move filtering/sorting logic from Node.js to Redis,
 * eliminating the need to load all room caches into memory.
 */

/**
 * Lua script that filters and sorts room caches.
 *
 * KEYS[1]: The roomcaches hash key
 * ARGV[1]: JSON-encoded conditions object
 * ARGV[2]: JSON-encoded sort options object (optional, can be empty string)
 *
 * Returns: Array of JSON-encoded room cache strings that match the conditions
 */
export const FILTER_AND_SORT_SCRIPT = `
local roomcaches_key = KEYS[1]
local conditions_json = ARGV[1]
local sort_options_json = ARGV[2]

-- Parse conditions
local conditions = {}
if conditions_json and conditions_json ~= '' then
  conditions = cjson.decode(conditions_json)
end

-- Parse sort options
local sort_options = {}
if sort_options_json and sort_options_json ~= '' then
  sort_options = cjson.decode(sort_options_json)
end

-- Get all room caches
local all_rooms = redis.call('HGETALL', roomcaches_key)
local matching_rooms = {}

-- Helper function to check if a room matches conditions
local function matches_conditions(room, conditions)
  for field, expected_value in pairs(conditions) do
    local actual_value = room[field]

    -- If field not in room, check metadata
    if actual_value == nil and room.metadata then
      actual_value = room.metadata[field]
    end

    -- If still nil and expected value exists, no match
    if actual_value == nil then
      return false
    end

    -- Compare values
    if actual_value ~= expected_value then
      return false
    end
  end
  return true
end

-- Micro optimization: filter by room name before parsing JSON
local room_name_filter = nil
if conditions.name then
  room_name_filter = '"name":"' .. conditions.name .. '"'
end

-- Iterate through room caches (HGETALL returns field, value, field, value, ...)
for i = 1, #all_rooms, 2 do
  local room_id = all_rooms[i]
  local room_json = all_rooms[i + 1]

  -- Skip rooms that don't match the name filter (before parsing JSON)
  if room_name_filter == nil or string.find(room_json, room_name_filter, 1, true) then
    local success, room = pcall(cjson.decode, room_json)
    if success and room then
      if matches_conditions(room, conditions) then
        table.insert(matching_rooms, { data = room, json = room_json, idx = i })
      end
    end
  end
end

-- Sort if sort options provided
if next(sort_options) ~= nil then
  table.sort(matching_rooms, function(a, b)
    for field, direction in pairs(sort_options) do
      -- Normalize direction to 1 or -1
      local dir = 1
      if direction == -1 or direction == 'desc' or direction == 'descending' then
        dir = -1
      end

      -- Get values from room or metadata
      local val_a = a.data[field]
      if val_a == nil and a.data.metadata then
        val_a = a.data.metadata[field]
      end

      local val_b = b.data[field]
      if val_b == nil and b.data.metadata then
        val_b = b.data.metadata[field]
      end

      -- Handle nil values (nil < any value)
      if val_a == nil and val_b ~= nil then
        return dir == 1
      elseif val_a ~= nil and val_b == nil then
        return dir == -1
      elseif val_a ~= nil and val_b ~= nil and val_a ~= val_b then
        if dir == 1 then
          return val_a < val_b
        else
          return val_a > val_b
        end
      end
      -- If equal, continue to next sort field
    end
    -- Fallback: preserve original insertion order for stable sorting
    return a.idx < b.idx
  end)
end

-- Return array of JSON strings
local results = {}
for _, room in ipairs(matching_rooms) do
  table.insert(results, room.json)
end

return results
`;

/**
 * Lua script that finds the first matching room cache.
 * Optimized to return early after finding the first match.
 *
 * KEYS[1]: The roomcaches hash key
 * ARGV[1]: JSON-encoded conditions object
 * ARGV[2]: JSON-encoded sort options object (optional, can be empty string)
 *
 * Returns: JSON-encoded room cache string of the first match, or nil if no match
 */
export const FIND_ONE_SCRIPT = `
local roomcaches_key = KEYS[1]
local conditions_json = ARGV[1]
local sort_options_json = ARGV[2]

-- Parse conditions
local conditions = {}
if conditions_json and conditions_json ~= '' then
  conditions = cjson.decode(conditions_json)
end

-- Parse sort options
local sort_options = {}
if sort_options_json and sort_options_json ~= '' then
  sort_options = cjson.decode(sort_options_json)
end

-- Get all room caches
local all_rooms = redis.call('HGETALL', roomcaches_key)

-- Helper function to check if a room matches conditions
local function matches_conditions(room, conditions)
  for field, expected_value in pairs(conditions) do
    local actual_value = room[field]

    -- If field not in room, check metadata
    if actual_value == nil and room.metadata then
      actual_value = room.metadata[field]
    end

    -- If still nil and expected value exists, no match
    if actual_value == nil then
      return false
    end

    -- Compare values
    if actual_value ~= expected_value then
      return false
    end
  end
  return true
end

-- Micro optimization: filter by room name before parsing JSON
local room_name_filter = nil
if conditions.name then
  room_name_filter = '"name":"' .. conditions.name .. '"'
end

-- If no sort options, we can return early on first match
if next(sort_options) == nil then
  for i = 1, #all_rooms, 2 do
    local room_id = all_rooms[i]
    local room_json = all_rooms[i + 1]

    -- Skip rooms that don't match the name filter (before parsing JSON)
    if room_name_filter == nil or string.find(room_json, room_name_filter, 1, true) then
      local success, room = pcall(cjson.decode, room_json)
      if success and room and matches_conditions(room, conditions) then
        return room_json
      end
    end
  end
  return nil
end

-- With sort options, we need to find all matches first, then sort
local matching_rooms = {}

for i = 1, #all_rooms, 2 do
  local room_id = all_rooms[i]
  local room_json = all_rooms[i + 1]

  -- Skip rooms that don't match the name filter (before parsing JSON)
  if room_name_filter == nil or string.find(room_json, room_name_filter, 1, true) then
    local success, room = pcall(cjson.decode, room_json)
    if success and room then
      if matches_conditions(room, conditions) then
        table.insert(matching_rooms, { data = room, json = room_json, idx = i })
      end
    end
  end
end

if #matching_rooms == 0 then
  return nil
end

-- Sort matching rooms
table.sort(matching_rooms, function(a, b)
  for field, direction in pairs(sort_options) do
    -- Normalize direction to 1 or -1
    local dir = 1
    if direction == -1 or direction == 'desc' or direction == 'descending' then
      dir = -1
    end

    -- Get values from room or metadata
    local val_a = a.data[field]
    if val_a == nil and a.data.metadata then
      val_a = a.data.metadata[field]
    end

    local val_b = b.data[field]
    if val_b == nil and b.data.metadata then
      val_b = b.data.metadata[field]
    end

    -- Handle nil values (nil < any value)
    if val_a == nil and val_b ~= nil then
      return dir == 1
    elseif val_a ~= nil and val_b == nil then
      return dir == -1
    elseif val_a ~= nil and val_b ~= nil and val_a ~= val_b then
      if dir == 1 then
        return val_a < val_b
      else
        return val_a > val_b
      end
    end
    -- If equal, continue to next sort field
  end
  -- Fallback: preserve original insertion order for stable sorting
  return a.idx < b.idx
end)

return matching_rooms[1].json
`;
