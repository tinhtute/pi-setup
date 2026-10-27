/**
 * pi-pretty configuration surface.
 *
 * A barrel over `./config/`: the implementation is split so that a change to the
 * icon table cannot touch the JSON loader, but every symbol that used to be
 * declared in this file is still exported from here, so no caller changed.
 *
 * Layout:
 *   config/ansi.ts         ANSI palette, writable bindings, background resolution
 *   config/config-file.ts  schema, loadConfig, tool-set resolvers
 *   config/icons.ts        Nerd Font file/dir icons
 *   config/lang.ts         extension -> Shiki language
 *   config/terminal.ts     clamped terminal width
 */

export * from "./config/ansi.js";
export * from "./config/config-file.js";
export * from "./config/icons.js";
export * from "./config/lang.js";
export * from "./config/terminal.js";
