import type { ServiceMethod } from '../service/service';

export type Request =
  | { id: number; type: 'open'; allowMemory: boolean }
  | { id: number; type: 'call'; method: ServiceMethod; args: unknown[] }
  | { id: number; type: 'close' }
  | { id: number; type: 'exportSnapshot' }
  | { id: number; type: 'restore'; bytes: Uint8Array };

export interface RestoreResult { boxes: number; items: number; fromVersion: number; ledgerRepaired: number }

export interface OpenInfo { persistent: boolean; schemaVersion: number; migratedFrom: number; sqliteVersion: string }

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { name: string; message: string; reason?: string } };
