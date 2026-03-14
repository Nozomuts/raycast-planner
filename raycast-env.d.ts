/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** gws Path - Path to the gws executable */
  "gwsPath": string,
  /** Calendar ID - Google Calendar ID to sync from */
  "calendarId": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `my-schedule` command */
  export type MySchedule = ExtensionPreferences & {}
  /** Preferences accessible in the `my-memo` command */
  export type MyMemo = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `my-schedule` command */
  export type MySchedule = {}
  /** Arguments passed to the `my-memo` command */
  export type MyMemo = {}
}

