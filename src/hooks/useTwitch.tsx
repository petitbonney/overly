import { Client } from "tmi.js";

let client: Client;

interface TwitchProps {
  channels: string[];
  username?: string;
  token?: string;
}

const useTwitch = async ({ channels, username, token }: TwitchProps) => {
  const config = {
    channels,
    identity: {
      username,
      password: token?.startsWith("oauth:") ? token : `oauth:${token}`,
    },
    options: {
      skipUpdatingEmotesets: true,
    },
  };

  const newClient = new Client(config);

  await newClient.connect().then(async () => {
    console.log(`Connected to ${channels.join(",")}`);
    await client
      ?.disconnect()
      .then(() => console.log(`Disconnected from ${client.getChannels().join(",")}`));
    client?.removeAllListeners();
    client = newClient;
  });

  return client;
};

export default useTwitch;
