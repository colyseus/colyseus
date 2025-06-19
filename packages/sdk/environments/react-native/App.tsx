import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Client } from "colyseus.js";

const client = new Client();
client.joinOrCreate("my_room").then((room) => {
  room.onStateChange((state) => {
    console.log("onStateChange:", state);
  });

  room.onLeave((code) => console.log("code", code));
});

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
