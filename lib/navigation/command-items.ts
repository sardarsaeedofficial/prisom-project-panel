/**
 * lib/navigation/command-items.ts
 *
 * Sprint 38: Types and builder for the global command palette.
 * Commands are permission-filtered at build time — no server secrets exposed.
 */

export type CommandItem = {
  id:    string;
  label: string;
  group: string;
  href:  string;
  icon:  React.ElementType;
};

export type CommandGroup = {
  label:    string;
  commands: CommandItem[];
};
