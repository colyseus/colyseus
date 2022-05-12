import { Room, Client } from "colyseus";
import { InputData, MyRoomState, Player } from "./schema/TestState";

export class MyRoom extends Room<MyRoomState> {
  fixedTimeStep = 1000 / 60;

  players: { [sessionId: string]: any } = {};

  onCreate(options: any) {
    this.setState(new MyRoomState());

    // set map dimensions
    this.state.mapWidth = 800;
    this.state.mapHeight = 600;

    this.onMessage(0, (client, input) => {
      // handle player input
      const player = this.state.players.get(client.sessionId);

      // enqueue input to user input buffer.
      player.inputQueue.push(input);
    });

    this.onMessage("hello", (client, input) => {
      // handle player input
      const player = this.state.players.get(client.sessionId);
      player.x = Number(input);

      // enqueue input to user input buffer.
      player.inputQueue.push(input);
    });

    this.onMessage("new", (client, input) => {
      // handle player input
      const player = this.state.players.get(client.sessionId);
      player.something = Number(input);
    });

    let elapsedTime = 0;
    this.setSimulationInterval((deltaTime) => {
      elapsedTime += deltaTime;

      while (elapsedTime >= this.fixedTimeStep) {
        elapsedTime -= this.fixedTimeStep;
        this.fixedTick(this.fixedTimeStep);
      }
    });
  }

  fixedTick(timeStep: number) {
    const velocity = 2;

    this.state.players.forEach(player => {
      let input: InputData;

      // dequeue player inputs
      while (input = player.inputQueue.shift()) {
        if (input.left) {
          player.x -= velocity;

        } else if (input.right) {
          player.x += velocity;
        }

        if (input.up) {
          player.y -= velocity;

        } else if (input.down) {
          player.y += velocity;
        }

        player.tick = input.tick;
      }
    });
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined! options =>", options);

    const player = new Player();
    player.x = Math.random() * this.state.mapWidth;
    player.y = Math.random() * this.state.mapHeight;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");
    this.state.players.delete(client.sessionId);
  }

  onCacheRoom() {
    return { hello: true };
  }

  onRestoreRoom(cached: any): void {
    console.log("ROOM HAS BEEN RESTORED!", cached);

    this.state.players.forEach(player => {
      player.method();
    });
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

}