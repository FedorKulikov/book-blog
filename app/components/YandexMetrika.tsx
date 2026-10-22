'use client'

import Script from 'next/script'

/**
 * Компонент-обёртка для счётчика Яндекс.Метрики.
 *
 * ID счётчика берётся из переменной окружения NEXT_PUBLIC_YANDEX_METRIKA_ID.
 * Если переменная не задана — компонент ничего не рендерит (на проде
 * достаточно добавить переменную, код страниц трогать не нужно).
 *
 * Скрипт подключается с strategy="afterInteractive", чтобы не блокировать
 * отрисовку сайта.
 */
export default function YandexMetrika() {
  const id = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID

  if (!id) return null

  return (
    <>
      <Script
        id="yandex-metrika"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
ym(${id}, 'init', {
clickmap:true,
trackLinks:true,
accurateTrackBounce:true,
webvisor:true
});`,
        }}
      />
      <noscript>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://mc.yandex.ru/watch/${id}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  )
}
