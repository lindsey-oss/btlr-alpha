import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.btlr.app",
  appName: "BTLR",
  // In production the native app loads the live Vercel deployment.
  // Update this URL once you have your Vercel domain.
  webDir: "out",                              // unused when server URL is set
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? "https://btlr-alpha.vercel.app",
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#1A2C44",            // BTLR navy
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",                         // white icons on navy bg
      backgroundColor: "#1A2C44",
    },
  },
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
