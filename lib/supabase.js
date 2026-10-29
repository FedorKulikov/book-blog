// lib/supabase.js
// Легаси-точка входа: 30+ файлов импортируют `{ supabase } from '@/lib/supabase'`.
// Оставляем реэкспорт, чтобы ВСЕ они начали использовать один и тот же
// cookie-клиент. Если оставить здесь старый createClient (localStorage),
// в приложении окажутся две разные сессии, и сервер перестанет видеть логин.
export { supabase } from './supabase/client'
