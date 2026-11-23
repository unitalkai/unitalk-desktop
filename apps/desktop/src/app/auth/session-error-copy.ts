import type { BundledLocale, Locale } from '@/i18n/types'

interface SessionErrorCopy {
  title: string
  description: string
}

const copy: Record<BundledLocale, SessionErrorCopy> = {
  en: { title: 'We couldn’t verify your session', description: 'Please sign in again to continue.' },
  ar: { title: 'تعذر التحقق من جلستك', description: 'سجّل الدخول مجددًا للمتابعة.' },
  de: { title: 'Deine Sitzung konnte nicht bestätigt werden', description: 'Melde dich erneut an, um fortzufahren.' },
  es: { title: 'No pudimos verificar tu sesión', description: 'Inicia sesión de nuevo para continuar.' },
  fr: { title: 'Nous n’avons pas pu vérifier votre session', description: 'Reconnectez-vous pour continuer.' },
  ja: { title: 'セッションを確認できませんでした', description: '続行するには再度サインインしてください。' },
  ru: { title: 'Не удалось проверить вашу сессию', description: 'Войдите снова, чтобы продолжить.' },
  zh: { title: '无法验证你的会话', description: '请重新登录以继续。' },
  'zh-hant': { title: '無法驗證你的工作階段', description: '請重新登入以繼續。' }
}

export function sessionErrorCopy(locale: Locale): SessionErrorCopy {
  return copy[locale as BundledLocale] ?? copy.en
}
