import { Room } from '../Room.ts';
import type { Client } from '../Transport.ts';
import type { IRoomCache } from '../matchmaker/driver.ts';
import * as matchMaker from '../MatchMaker.ts';
import { debugMatchMaking } from '../Debug.ts';
import { ServerError } from '../errors/ServerError.ts';
import { CloseCode, ErrorCode } from '@colyseus/shared-types';

export interface QueueOptions {
  /**
   * number of players on each match
   */
  maxPlayers?: number;

  /**
   * name of the room to create
   */
  matchRoomName: string;

  /**
   * after these cycles, create a match with a bot
   */
  maxWaitingCycles?: number;

  /**
   * after this time, try to fit this client with a not-so-compatible group
   */
  maxWaitingCyclesForPriority?: number;

  /**
   * If set, teams must have the same size to be matched together
   */
  maxTeamSize?: number;

  /**
   * If `allowIncompleteGroups` is true, players inside an unmatched group (that
   * did not reached `maxPlayers`, and `maxWaitingCycles` has been
   * reached) will be matched together. Your room should fill the remaining
   * spots with "bots" on this case.
   */
  allowIncompleteGroups?: boolean;

  /**
   * Comparison function for matching clients to groups
   * Returns true if the client is compatible with the group
   */
  compare?: (client: QueueClientData, matchGroup: QueueMatchGroup) => boolean;

  /**
   *
   * When onGroupReady is set, the "roomNameToCreate" option is ignored.
   */
  onGroupReady?: (this: QueueRoom, group: QueueMatchGroup) => Promise<IRoomCache>;
}

export interface QueueMatchGroup {
  averageRank: number;
  clients: Array<Client<{ userData: QueueClientData }>>,
  ready?: boolean;
  confirmed?: number;
}

export interface QueueMatchTeam {
  averageRank: number;
  clients: Array<Client<{ userData: QueueClientData }>>,
  teamId: string | symbol;
}

export interface QueueClientData {
  /**
   * Rank of the client
   */
  rank: number;

  /**
   * Timestamp of when the client entered the queue
   */
  currentCycle?: number;

  /**
   * Optional: if matching with a team, the team ID
   */
  teamId?: string;

  /**
   * Additional options passed by the client when joining the room
   */
  options?: any;

  /**
   * Match group the client is currently in
   */
  group?: QueueMatchGroup;

  /**
   * Whether the client has confirmed the connection to the room
   */
  confirmed?: boolean;

  /**
   * Whether the client should be prioritized in the queue
   * (e.g. for players that are waiting for a long time)
   */
  highPriority?: boolean;

  /**
   * The last number of clients in the queue sent to the client
   */
  lastQueueClientCount?: number;
}

//
// Optional: strongly-typed client messages
// (This is optional, but recommended for better type safety and code generation for native SDKs)
//
type QueueClient = Client<{
  userData: QueueClientData;
  messages: {
    clients: number;
    seat: matchMaker.ISeatReservation;
  }
}>;

const DEFAULT_TEAM = Symbol("$default_team");
const DEFAULT_COMPARE = (client: QueueClientData, matchGroup: QueueMatchGroup) => {
  const diff = Math.abs(client.rank - matchGroup.averageRank);
  const diffRatio = (diff / matchGroup.averageRank);
  // If diff ratio is too high, create a new match group
  return (diff < 10 || diffRatio <= 2);
}

export class QueueRoom extends Room {
  maxPlayers = 4;
  maxTeamSize: number;
  allowIncompleteGroups: boolean = false;

  maxWaitingCycles = 15;
  maxWaitingCyclesForPriority?: number = 10;

  /**
   * Evaluate groups for each client at interval
   */
  cycleTickInterval = 1000;

  /**
   * Groups of players per iteration
   */
  groups: QueueMatchGroup[] = [];
  highPriorityGroups: QueueMatchGroup[] = [];

  matchRoomName: string;

  protected compare = DEFAULT_COMPARE;
  protected onGroupReady = (group: QueueMatchGroup) => matchMaker.createRoom(this.matchRoomName, {});

  messages = {
    confirm: (client: Client, _: unknown) => {
      const queueData = client.userData;

      if (queueData && queueData.group && typeof (queueData.group.confirmed) === "number") {
        queueData.confirmed = true;
        queueData.group.confirmed++;
        client.leave(CloseCode.NORMAL_CLOSURE);
      }
    },
  }

  onCreate(options: QueueOptions) {
    if (typeof(options.maxWaitingCycles) === "number") {
      this.maxWaitingCycles = options.maxWaitingCycles;
    }

    if (typeof(options.maxPlayers) === "number") {
      this.maxPlayers = options.maxPlayers;
    }

    if (typeof(options.maxTeamSize) === "number") {
      this.maxTeamSize = options.maxTeamSize;
    }

    if (typeof(options.allowIncompleteGroups) !== "undefined") {
      this.allowIncompleteGroups = options.allowIncompleteGroups;
    }

    if (typeof(options.compare) === "function") {
      this.compare = options.compare;
    }

    if (typeof(options.onGroupReady) === "function") {
      this.onGroupReady = options.onGroupReady;
    }

    if (options.matchRoomName) {
      this.matchRoomName = options.matchRoomName;

    } else {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, "QueueRoom: 'matchRoomName' option is required.");
    }

    debugMatchMaking("QueueRoom#onCreate() maxPlayers: %d, maxWaitingCycles: %d, maxTeamSize: %d, allowIncompleteGroups: %d, roomNameToCreate: %s", this.maxPlayers, this.maxWaitingCycles, this.maxTeamSize, this.allowIncompleteGroups, this.matchRoomName);

    /**
     * Redistribute clients into groups at every interval
     */
    this.setSimulationInterval(() => this.reassignMatchGroups(), this.cycleTickInterval);
  }

  onJoin(client: QueueClient, options: any, auth?: unknown) {
    this.addToQueue(client, {
      rank: options.rank,
      teamId: options.teamId,
      options,
    });
  }

  addToQueue(client: QueueClient, queueData: QueueClientData) {
    if (queueData.currentCycle === undefined) {
      queueData.currentCycle = 0;
    }
    client.userData = queueData;

    // FIXME: reassign groups upon joining [?] (without incrementing cycle count)
    client.send("clients", 1);
  }

  createMatchGroup() {
    const group: QueueMatchGroup = { clients: [], averageRank: 0 };
    this.groups.push(group);
    return group;
  }

  reassignMatchGroups() {
    // Re-set all groups
    this.groups.length = 0;
    this.highPriorityGroups.length = 0;

    const sortedClients = (this.clients)
      .filter((client) => {
        // Filter out:
        // - clients that are not in the queue
        // - clients that are already in a "ready" group
        return (
          client.userData &&
          client.userData.group?.ready !== true
        );
      })
      .sort((a, b) => {
        //
        // Sort by rank ascending
        //
        return a.userData.rank - b.userData.rank;
      });

    //
    // The room either distribute by teams or by clients
    //
    if (typeof(this.maxTeamSize) === "number") {
      this.redistributeTeams(sortedClients);

    } else {
      this.redistributeClients(sortedClients);
    }

    this.evaluateHighPriorityGroups();
    this.processGroupsReady();
  }

  redistributeTeams(sortedClients: Client<{ userData: QueueClientData }>[]) {
    const teamsByID: { [teamId: string | symbol]: QueueMatchTeam } = {};

    sortedClients.forEach((client) => {
      const teamId = client.userData.teamId || DEFAULT_TEAM;

      // Create a new team if it doesn't exist
      if (!teamsByID[teamId]) {
        teamsByID[teamId] = { teamId: teamId, clients: [], averageRank: 0, };
      }

      teamsByID[teamId].averageRank += client.userData.rank;
      teamsByID[teamId].clients.push(client);
    });

    // Calculate average rank for each team
    let teams = Object.values(teamsByID).map((team) => {
      team.averageRank /= team.clients.length;
      return team;
    }).sort((a, b) => {
      // Sort by average rank ascending
      return a.averageRank - b.averageRank;
    });

    // Iterate over teams multiple times until all clients are assigned to a group
    do {
      let currentGroup: QueueMatchGroup = this.createMatchGroup();
      teams = teams.filter((team) => {
        // Remove clients from the team and add them to the current group
        const totalRank = team.averageRank * team.clients.length;

        // currentGroup.averageRank = (currentGroup.averageRank === undefined)
        //   ? team.averageRank
        //   : (currentGroup.averageRank + team.averageRank) / ;
        currentGroup = this.redistributeClients(team.clients.splice(0, this.maxTeamSize), currentGroup, totalRank);

        if (team.clients.length >= this.maxTeamSize) {
          // team still has enough clients to form a group
          return true;
        }

        // increment cycle count for all clients in the team
        team.clients.forEach((client) => client.userData.currentCycle++);

        return false;
      });
    } while (teams.length >= 2);
  }

  redistributeClients(
    sortedClients: Client<{ userData: QueueClientData }>[],
    currentGroup: QueueMatchGroup = this.createMatchGroup(),
    totalRank: number = 0,
  ) {
    for (let i = 0, l = sortedClients.length; i < l; i++) {
      const client = sortedClients[i];
      const userData = client.userData;
      const currentCycle = userData.currentCycle++;

      if (currentGroup.averageRank > 0) {
        if (
          !this.compare(userData, currentGroup) &&
          !userData.highPriority
        ) {
          currentGroup = this.createMatchGroup();
          totalRank = 0;
        }
      }

      userData.group = currentGroup;
      currentGroup.clients.push(client);

      totalRank += userData.rank;
      currentGroup.averageRank = totalRank / currentGroup.clients.length;

      // Enough players in the group, mark it as ready!
      if (currentGroup.clients.length === this.maxPlayers) {
        currentGroup.ready = true;
        currentGroup = this.createMatchGroup();
        totalRank = 0;
        continue;
      }

      if (currentCycle >= this.maxWaitingCycles && this.allowIncompleteGroups) {
        /**
         * Match long-waiting clients with bots
         */
        if (this.highPriorityGroups.indexOf(currentGroup) === -1) {
          this.highPriorityGroups.push(currentGroup);
        }

      } else if (
        this.maxWaitingCyclesForPriority !== undefined &&
        currentCycle >= this.maxWaitingCyclesForPriority
      ) {
        /**
         * Force this client to join a group, even if rank is incompatible
         */
        userData.highPriority = true;
      }
    }

    return currentGroup;
  }

  evaluateHighPriorityGroups() {
    /**
     * Evaluate groups with high priority clients
     */
    this.highPriorityGroups.forEach((group) => {
      group.ready = group.clients.every((c) => {
        // Give new clients another chance to join a group that is not "high priority"
        return c.userData?.currentCycle > 1;
        // return c.userData?.currentCycle >= this.maxWaitingCycles;
      });
    });
  }

  processGroupsReady() {
    this.groups.forEach(async (group) => {
      if (group.ready) {
        group.confirmed = 0;

        try {
          /**
           * Create room instance in the server.
           */
          const room = await this.onGroupReady.call(this, group);

          /**
           * Reserve a seat for each client in the group.
           * (If one fails, force all clients to leave, re-queueing is up to the client-side logic)
           */
          await matchMaker.reserveMultipleSeatsFor(
            room,
            group.clients.map((client) => ({
              sessionId: client.sessionId,
              options: client.userData.options,
              auth: client.auth,
            })),
          );

          /**
           * Send room data for new WebSocket connection!
           */
          group.clients.forEach((client, i) => {
            client.send("seat", matchMaker.buildSeatReservation(room, client.sessionId));
          });

        } catch (e: any) {
          //
          // If creating a room, or reserving a seat failed - fail all clients
          // Whether the clients retry or not is up to the client-side logic
          //
          group.clients.forEach(client => client.leave(1011, e.message));
        }

      } else {
        /**
         * Notify clients within the group on how many players are in the queue
         */
        group.clients.forEach((client) => {
          //
          // avoid sending the same number of clients to the client if it hasn't changed
          //
          const queueClientCount = group.clients.length;
          if (client.userData.lastQueueClientCount !== queueClientCount) {
            client.userData.lastQueueClientCount = queueClientCount;
            client.send("clients", queueClientCount);
          }
        });
      }
    });
  }

}