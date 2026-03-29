/**
 * Face Storage Service
 * ====================
 * IndexedDB-based storage for face identities and embeddings.
 * All data is stored locally in the browser.
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { FaceIdentity, FaceSample, StoredFaceSample } from '@/types/face';
import { assertValidFaceEmbedding } from '@/types/face';

const DB_NAME = 'face-memory-db';
const DB_VERSION = 1;

interface FaceMemoryDB extends DBSchema {
  identities: {
    key: string;
    value: FaceIdentity;
    indexes: {
      'by-name': string;
      'by-created': number;
    };
  };
  samples: {
    key: string;
    value: StoredFaceSample;
    indexes: {
      'by-identity': string;
      'by-created': number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<FaceMemoryDB>> | null = null;

async function getDB(): Promise<IDBPDatabase<FaceMemoryDB>> {
  if (dbPromise) return dbPromise;

  dbPromise = openDB<FaceMemoryDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('identities')) {
        const identityStore = db.createObjectStore('identities', {
          keyPath: 'id',
        });
        identityStore.createIndex('by-name', 'name');
        identityStore.createIndex('by-created', 'createdAt');
      }

      if (!db.objectStoreNames.contains('samples')) {
        const sampleStore = db.createObjectStore('samples', {
          keyPath: 'id',
        });
        sampleStore.createIndex('by-identity', 'identityId');
        sampleStore.createIndex('by-created', 'capturedAt');
      }
    },
  });

  return dbPromise;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function cloneEmbedding(embedding: Float32Array): Float32Array {
  return new Float32Array(embedding);
}

// ============================================================================
// IDENTITY OPERATIONS
// ============================================================================

export async function getAllIdentities(): Promise<FaceIdentity[]> {
  const db = await getDB();
  return db.getAll('identities');
}

export async function getIdentity(id: string): Promise<FaceIdentity | undefined> {
  const db = await getDB();
  return db.get('identities', id);
}

export async function createIdentity(name: string): Promise<FaceIdentity> {
  const db = await getDB();
  const now = Date.now();

  const identity: FaceIdentity = {
    id: generateId(),
    name: name.trim(),
    samples: [],
    createdAt: now,
    updatedAt: now,
  };

  await db.put('identities', identity);
  return identity;
}

export async function updateIdentityName(
  identityId: string,
  newName: string
): Promise<FaceIdentity | null> {
  const db = await getDB();
  const identity = await db.get('identities', identityId);

  if (!identity) return null;

  identity.name = newName.trim();
  identity.updatedAt = Date.now();

  await db.put('identities', identity);
  return identity;
}

export async function deleteIdentity(identityId: string): Promise<void> {
  const db = await getDB();
  const samples = await db.getAllFromIndex('samples', 'by-identity', identityId);
  const tx = db.transaction(['identities', 'samples'], 'readwrite');

  for (const sample of samples) {
    await tx.objectStore('samples').delete(sample.id);
  }

  await tx.objectStore('identities').delete(identityId);
  await tx.done;
}

export async function clearAllIdentities(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['identities', 'samples'], 'readwrite');
  await tx.objectStore('identities').clear();
  await tx.objectStore('samples').clear();
  await tx.done;
}

// ============================================================================
// SAMPLE OPERATIONS
// ============================================================================

export async function addSample(
  identityId: string,
  embedding: Float32Array,
  thumbnail?: string,
  source: 'webcam' | 'upload' = 'webcam'
): Promise<FaceSample> {
  assertValidFaceEmbedding(embedding);

  const db = await getDB();

  // Bug 10 fix: open the transaction first, then re-read the identity inside it.
  // Previously the identity was read outside the transaction, allowing concurrent
  // addSample() calls to clobber each other's samples[] via stale overwrite.
  const tx = db.transaction(['identities', 'samples'], 'readwrite');
  const identity = await tx.objectStore('identities').get(identityId);

  if (!identity) {
    tx.abort();
    throw new Error(`Identity ${identityId} not found`);
  }

  const now = Date.now();
  const sample: FaceSample = {
    id: generateId(),
    embedding: cloneEmbedding(embedding),
    thumbnail,
    capturedAt: now,
    source,
  };

  await tx.objectStore('samples').put({
    ...sample,
    identityId,
  });

  identity.samples.push(sample);
  identity.updatedAt = now;
  await tx.objectStore('identities').put(identity);

  await tx.done;
  return sample;
}

export async function removeSample(
  identityId: string,
  sampleId: string
): Promise<void> {
  const db = await getDB();
  const identity = await db.get('identities', identityId);

  if (!identity) return;

  const tx = db.transaction(['identities', 'samples'], 'readwrite');

  await tx.objectStore('samples').delete(sampleId);

  identity.samples = identity.samples.filter((sample) => sample.id !== sampleId);
  identity.updatedAt = Date.now();
  await tx.objectStore('identities').put(identity);

  await tx.done;
}

export async function getSamplesForIdentity(
  identityId: string
): Promise<StoredFaceSample[]> {
  const db = await getDB();
  return db.getAllFromIndex('samples', 'by-identity', identityId);
}

// ============================================================================
// EMBEDDING OPERATIONS
// ============================================================================

export async function getAllEmbeddings(): Promise<
  Array<{
    identityId: string;
    identityName: string;
    embedding: Float32Array;
  }>
> {
  const db = await getDB();
  const [identities, samples] = await Promise.all([
    db.getAll('identities'),
    db.getAll('samples'),
  ]);

  const identityNameById = new Map(
    identities.map((identity) => [identity.id, identity.name] as const)
  );

  return samples
    .filter((sample) => identityNameById.has(sample.identityId))
    .map((sample) => ({
      identityId: sample.identityId,
      identityName: identityNameById.get(sample.identityId) ?? 'Unknown',
      embedding: cloneEmbedding(sample.embedding),
    }));
}

export async function getIdentityCount(): Promise<number> {
  const db = await getDB();
  return db.count('identities');
}

export async function getSampleCount(): Promise<number> {
  const db = await getDB();
  return db.count('samples');
}
