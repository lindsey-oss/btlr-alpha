// lib/push-notifications.ts
// Handles Capacitor push notification registration.
// Safe to import in web — all Capacitor calls are guarded by isNativePlatform().

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/** True when running inside a Capacitor iOS/Android shell */
export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

/** Returns 'ios' | 'android' | 'web' */
export function getPlatform(): "ios" | "android" | "web" {
  if (typeof window === "undefined") return "web";
  const cap = (window as any).Capacitor;
  if (!cap) return "web";
  const p = cap.getPlatform?.() as string | undefined;
  if (p === "ios") return "ios";
  if (p === "android") return "android";
  return "web";
}

/**
 * Request permission and register the device push token with the server.
 * Call this once after the user is authenticated.
 * Safe no-op on web (returns immediately).
 */
export async function registerPushNotifications(): Promise<void> {
  if (!isNative()) return;

  try {
    // Dynamic import so the module doesn't break the web bundle
    const { PushNotifications } = await import("@capacitor/push-notifications");

    // Check / request permission
    let permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === "prompt") {
      permStatus = await PushNotifications.requestPermissions();
    }
    if (permStatus.receive !== "granted") {
      console.log("[push] Permission denied");
      return;
    }

    // Register with APNs / FCM
    await PushNotifications.register();

    // Listen for the token
    PushNotifications.addListener("registration", async ({ value: token }) => {
      console.log("[push] Token received:", token.slice(0, 20) + "…");
      await saveToken(token);
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("[push] Registration error:", err);
    });

    // Handle foreground notifications (show as alert on iOS)
    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      console.log("[push] Foreground notification:", notification.title);
    });

    // Handle tap on a notification
    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      console.log("[push] Notification tapped:", action.notification.title);
      // Future: deep-link into the relevant tab based on action.notification.data
    });
  } catch (err) {
    console.error("[push] Setup error:", err);
  }
}

/** Saves the device token to the server via /api/push-token */
async function saveToken(token: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const authToken = session?.access_token;
    const platform = getPlatform();

    const res = await fetch("/api/push-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ token, platform }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("[push] Failed to save token:", body.error);
    } else {
      console.log("[push] Token saved successfully");
    }
  } catch (err) {
    console.error("[push] saveToken error:", err);
  }
}
