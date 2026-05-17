import { Entry } from '@napi-rs/keyring';

export const KEYCHAIN_SERVICE = 'invoice-cli';
export const SMTP_PASSWORD_ACCOUNT = 'smtp-app-password';
export const IMAP_PASSWORD_ACCOUNT = 'imap-app-password';

export function getPassword(account: string): string | null {
  try {
    return new Entry(KEYCHAIN_SERVICE, account).getPassword();
  } catch {
    return null;
  }
}

export function setPassword(account: string, password: string): void {
  new Entry(KEYCHAIN_SERVICE, account).setPassword(password);
}

export function deletePassword(account: string): boolean {
  try {
    return new Entry(KEYCHAIN_SERVICE, account).deletePassword();
  } catch {
    return false;
  }
}
