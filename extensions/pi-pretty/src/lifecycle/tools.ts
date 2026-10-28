/**
 * Register pi-pretty's renderers for the four file tools.
 *
 * Each tool is re-registered with a pretty renderer, keeping the original
 * definition from the host SDK. A tool is skipped when the config disables it or
 * the host does not provide a factory for it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as hostSdk from "@earendil-works/pi-coding-agent";
import { registerBashTool } from "../tools/bash.js";
import { registerFindTool } from "../tools/find.js";
import { registerGrepTool } from "../tools/grep.js";
import { registerReadTool } from "../tools/read.js";
import type { PiPrettyDeps, SdkTools } from "../types.js";

export interface ToolRegistrationOptions {
	pi: ExtensionAPI;
	cwd: string;
	isToolEnabled(name: string): boolean;
	/** Injected Text component for custom rendering; falls back to the host's. */
	textComponent: PiPrettyDeps["TextComponent"];
	depsSdk?: SdkTools;
}

export function registerPrettyTools(options: ToolRegistrationOptions): void {
	const { pi, cwd, isToolEnabled, textComponent, depsSdk } = options;

	// Pi aliases static SDK imports to its host package for managed extensions.
	// Native dynamic imports bypass that alias because the managed npm root omits
	// Pi peer dependencies.
	const sdk: SdkTools = depsSdk ?? {
		createReadToolDefinition: hostSdk.createReadToolDefinition,
		createBashToolDefinition: hostSdk.createBashToolDefinition,
		createFindToolDefinition: hostSdk.createFindToolDefinition,
		createGrepToolDefinition: hostSdk.createGrepToolDefinition,
	};
	const createReadTool = sdk.createReadToolDefinition ?? sdk.createReadTool;
	const createBashTool = sdk.createBashToolDefinition ?? sdk.createBashTool;
	const createFindTool = sdk.createFindToolDefinition ?? sdk.createFindTool;
	const createGrepTool = sdk.createGrepToolDefinition ?? sdk.createGrepTool;

	if (isToolEnabled("read") && createReadTool) {
		registerReadTool(pi, cwd, createReadTool(cwd), textComponent);
	}
	if (isToolEnabled("bash") && createBashTool) {
		registerBashTool(pi, cwd, createBashTool(cwd), textComponent);
	}
	if (isToolEnabled("find") && createFindTool) {
		registerFindTool(pi, cwd, createFindTool(cwd), textComponent);
	}
	if (isToolEnabled("grep") && createGrepTool) {
		registerGrepTool(pi, cwd, createGrepTool(cwd), textComponent);
	}
}
