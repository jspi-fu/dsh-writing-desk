import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  LANGUAGE_STORAGE_KEY,
  currentLang,
  initI18n,
  normalizeLanguagePreference,
  onLanguageChange,
  preferenceToLang,
  readLanguagePreference,
  setActiveLang,
  t as translate,
  writeLanguagePreference,
  type Lang,
  type LanguagePreference,
} from '@/lib/i18n'

interface LocaleContextValue {
  lang: Lang
  preference: LanguagePreference
  setPreference: (preference: LanguagePreference) => void
  t: typeof translate
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

function applyPreference(preference: LanguagePreference): void {
  setActiveLang(preferenceToLang(preference))
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>('system')
  const [lang, setLang] = useState<Lang>(() => currentLang())

  useEffect(() => {
    initI18n()
    const unsubscribe = onLanguageChange(setLang)

    void readLanguagePreference().then(stored => {
      setPreferenceState(stored)
      applyPreference(stored)
    })

    return unsubscribe
  }, [])

  // Keep the preference state in sync when another panel window changes it.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes[LANGUAGE_STORAGE_KEY]) return
      const next = normalizeLanguagePreference(changes[LANGUAGE_STORAGE_KEY].newValue)
      setPreferenceState(next)
      applyPreference(next)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const setPreference = useCallback((next: LanguagePreference) => {
    setPreferenceState(next)
    applyPreference(next)
    void writeLanguagePreference(next)

    const nextLang = preferenceToLang(next)
    try {
      chrome.runtime.sendMessage({
        type: 'LANGUAGE_CHANGED',
        payload: { preference: next, lang: nextLang },
      }).catch(() => {})
    } catch {
      // Extension contexts that cannot reach the service worker still render.
    }
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({ lang, preference, setPreference, t: translate }),
    [lang, preference, setPreference]
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useI18n(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('useI18n must be used within LocaleProvider')
  return context
}