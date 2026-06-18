import { fetchProxy } from '@libs/extension'
import { storage } from '@libs/storage'
import { addDays } from 'date-fns/addDays'

type StoredAPIKey = { retrievalDate: string; value: string }
const STORAGE_KEY = 'apiKey'

export async function fetchAPIKey() {
  const stored = await storage.get<StoredAPIKey>(STORAGE_KEY)
  const notExpired = stored && addDays(new Date(), 2) > new Date(stored.retrievalDate)
  const shouldRefresh = stored && addDays(new Date(), 1) < new Date(stored.retrievalDate)
  if (stored?.value && notExpired) {
    if (shouldRefresh) refreshAPIKey()
    return stored.value
  }
  return refreshAPIKey()
}

export const refreshAPIKey = () =>
  fetchProxy('https://www.youtube.com/feed/you')
    .then((res) => res.text())
    .then((text) => text.split('"INNERTUBE_API_KEY":"')[1].split('"')[0])
    .then(async (value) => {
      await storage.set(STORAGE_KEY, {
        retrievalDate: new Date().toISOString(),
        value,
      } satisfies StoredAPIKey)
      return value
    })
