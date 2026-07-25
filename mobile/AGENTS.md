# mobile/ is THE Talise Android client

This Expo / React Native app is the one and only Android client. The native
Kotlin app that used to live at `android/` was deleted on 2026-07-25 — both
shipped the same `applicationId` (io.talise.app), and this is the real one.
There is no native `android/` subdirectory here: the workflow is Expo managed,
so EAS prebuilds Android at build time.

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
