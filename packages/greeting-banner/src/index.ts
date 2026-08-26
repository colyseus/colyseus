const banner = (process.env.COLYSEUS_CLOUD)
  ? 
  // "Slant" (https://patorjk.com/software/taag/#p=display&f=Slant)
  String.raw`
   ______      __                              ________                __
  / ____/___  / /_  __________  __  _______   / ____/ /___  __  ______/ /
 / /   / __ \/ / / / / ___/ _ \/ / / / ___/  / /   / / __ \/ / / / __  /
/ /___/ /_/ / / /_/ (__  )  __/ /_/ (__  )  / /___/ / /_/ / /_/ / /_/ /
\____/\____/_/\__, /____/\___/\__,_/____/   \____/_/\____/\__,_/\__,_/
             /____/

❓ Don't hesitate to contact support@colyseus.io if you have any issues.
🚀 Thank you for using Colyseus Cloud
`

  : 
  // "Ogre" (https://patorjk.com/software/taag/#p=display&f=Ogre)
  String.raw`
   ___      _                                   ___   _  ___  
  / __\___ | |_   _ ___  ___ _   _ ___  __   __/ _ \ / |( _ ) 
 / /  / _ \| | | | / __|/ _ \ | | / __| \ \ / / | | || |/ _ \ 
/ /__| (_) | | |_| \__ \  __/ |_| \__ \  \ V /| |_| || | (_) |
\____/\___/|_|\__, |___/\___|\__,_|___/   \_/  \___(_)_|\___/ 
              |___/                                           

             · Multiplayer Framework for Node.js ·

💖 Consider becoming a Sponsor on GitHub → https://github.com/sponsors/endel
🌟 Give us a star on GitHub → https://github.com/colyseus/colyseus
☁️  Deploy and scale your project on Colyseus Cloud → https://cloud.colyseus.io
`;

export function greet() {
  console.log(banner);
}
