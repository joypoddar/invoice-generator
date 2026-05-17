import { ImapFlow } from 'imapflow';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  secure?: boolean;
}

export interface FolderInfo {
  path: string;
  name: string;
  specialUse?: string | undefined;
}

export interface FetchedMessage {
  uid: number;
  source: Buffer;
}

export async function connect(config: ImapConfig, password: string): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure ?? true,
    auth: { user: config.user, pass: password },
    logger: false,
  });
  await client.connect();
  return client;
}

export async function listFolders(client: ImapFlow): Promise<FolderInfo[]> {
  const folders = await client.list();
  return folders.map((f) => ({
    path: f.path,
    name: f.name,
    specialUse: f.specialUse,
  }));
}

export async function* fetchSince(
  client: ImapFlow,
  folder: string,
  lastUid: number,
): AsyncIterable<FetchedMessage> {
  const lock = await client.getMailboxLock(folder);
  try {
    const minUid = lastUid + 1;
    const uids = await client.search(
      {
        uid: `${minUid}:*`,
        header: { 'X-Invoice-Generator': '1' },
      },
      { uid: true },
    );
    if (!uids || uids.length === 0) return;

    for await (const msg of client.fetch(uids, { source: true, uid: true }, { uid: true })) {
      if (msg.source && typeof msg.uid === 'number') {
        yield { uid: msg.uid, source: msg.source };
      }
    }
  } finally {
    lock.release();
  }
}
