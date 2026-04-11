import { createEndpoint, createRouter, defineRoom, defineServer, monitor, playground } from 'colyseus';
import { MyRoom } from '../MyRoom.ts';

export const server = defineServer({
  rooms: {
    my_room: defineRoom(MyRoom),
  },

  express: (app) => {
    app.get('/express-hello', (req, res) => {
      res.json({ message: 'Hello from Express!' });
    });

    app.use('/playground', playground());
    app.use('/monitor', monitor());
  },

  routes: createRouter({
    hello: createEndpoint("/hello", { method: "GET" }, async (ctx) => {
      return { message: "Hello world!" };
    }),

    time: createEndpoint("/time", { method: "GET" }, async (ctx) => {
      return { time: Date.now() };
    }),
  }),
});
