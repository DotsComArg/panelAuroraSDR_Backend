/**
 * Lógica de sincronización de IDs de cuentas Kommo.
 * Usado por script y endpoint admin.
 */

import { getMongoDb } from './mongodb.js';
import { decrypt } from './encryption-utils.js';
import { fetchKommoAccountIdFromApi } from './api-kommo.js';
import type { Customer } from './customer-types.js';

function hasKommoCredentials(c: Customer): boolean {
  const hasFirst = !!(c.kommoCredentials?.accessToken);
  const hasAccounts = (c.kommoAccounts?.length ?? 0) > 0;
  return hasFirst || hasAccounts;
}

export interface SyncResult {
  total: number;
  withKommo: number;
  updated: number;
  errors: number;
  details: Array<{
    customerId: string;
    name: string;
    kommo1?: { accountId: string | null; updated: boolean; error?: string };
    kommoAccounts?: Array<{ accountId: string | null; updated: boolean; error?: string }>;
  }>;
}

export async function syncKommoAccountIds(): Promise<SyncResult> {
  const result: SyncResult = {
    total: 0,
    withKommo: 0,
    updated: 0,
    errors: 0,
    details: [],
  };

  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY no está configurada');
  }

  const db = await getMongoDb();
  const customersCollection = db.collection<Customer>('customers');
  const customers = await customersCollection.find({}).toArray();

  result.total = customers.length;
  const withKommo = customers.filter(hasKommoCredentials);
  result.withKommo = withKommo.length;

  for (const customer of withKommo) {
    const customerId = customer._id!.toString();
    const name = customer.nombre || customer.email || 'Sin nombre';
    const detail: SyncResult['details'][0] = {
      customerId,
      name,
    };

    const updates: Record<string, any> = {};
    let needsUpdate = false;

    // 1) kommoCredentials
    if (customer.kommoCredentials?.accessToken) {
      try {
        let baseUrl = (customer.kommoCredentials.baseUrl || '').trim();
        if (baseUrl && !baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
        const accessToken = decrypt(customer.kommoCredentials.accessToken);
        const accountId = await fetchKommoAccountIdFromApi({ baseUrl, accessToken });
        const current = (customer.kommoCredentials as any).accountId;
        const updated_flag = current !== accountId;
        detail.kommo1 = { accountId: accountId || null, updated: updated_flag };
        if (accountId && updated_flag) {
          updates['kommoCredentials.accountId'] = accountId;
          needsUpdate = true;
        } else if (!accountId) {
          result.errors++;
        }
      } catch (e: any) {
        detail.kommo1 = { accountId: null, updated: false, error: e?.message || String(e) };
        result.errors++;
      }
    }

    // 2) kommoAccounts
    const accounts = customer.kommoAccounts ?? [];
    const newAccounts = [...accounts];
    let kommoAccountsChanged = false;
    const accDetails: Array<{ accountId: string | null; updated: boolean; error?: string }> = [];

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      if (!acc?.accessToken) {
        accDetails.push({ accountId: null, updated: false });
        continue;
      }
      try {
        let baseUrl = (acc.baseUrl || '').trim();
        if (baseUrl && !baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
        const accessToken = decrypt(acc.accessToken);
        const accountId = await fetchKommoAccountIdFromApi({ baseUrl, accessToken });
        const current = (acc as any).accountId;
        const updated_flag = current !== accountId;
        accDetails.push({ accountId: accountId || null, updated: updated_flag });
        if (accountId && updated_flag) {
          newAccounts[i] = { ...acc, accountId };
          kommoAccountsChanged = true;
          needsUpdate = true;
        } else if (!accountId) {
          result.errors++;
        }
      } catch (e: any) {
        accDetails.push({ accountId: null, updated: false, error: e?.message || String(e) });
        result.errors++;
      }
    }
    if (accDetails.length > 0) detail.kommoAccounts = accDetails;
    if (kommoAccountsChanged) updates['kommoAccounts'] = newAccounts;

    if (needsUpdate) {
      updates.updatedAt = new Date();
      await customersCollection.updateOne(
        { _id: customer._id },
        { $set: updates }
      );
      result.updated++;
    }

    result.details.push(detail);
  }

  return result;
}
