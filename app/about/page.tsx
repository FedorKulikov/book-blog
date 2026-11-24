import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'О проекте',
  description:
    'Как устроен проект «Хлеба и букв», что здесь могут найти читатели и авторы и как участвовать в жизни сайта.',
}

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 md:p-8">
      <div className="mb-8">
        <p className="mb-2 text-xs uppercase tracking-wider text-brown/50">Хлеба и букв</p>
        <h1 className="font-playfair text-3xl font-bold text-emerald-dark md:text-4xl">
          О проекте
        </h1>
        <p className="mt-4 text-base leading-8 text-brown-dark">
          «Хлеба и букв» — книжный сайт и блог о книгах, который объединяет
          читателей и авторов. Здесь можно находить новые книги, делиться
          впечатлениями, публиковать собственные тексты и обсуждать прочитанное.
        </p>
      </div>

      <div className="space-y-7 text-sm leading-7 text-brown-dark">
        <section>
          <h2 className="mb-2 font-playfair text-xl font-bold text-emerald-dark">
            Для кого создан проект
          </h2>
          <p>
            Это сообщество читателей и авторов: для тех, кто любит литературу,
            выбирает следующую книгу, ищет мнения других людей или хочет рассказать
            о собственном чтении. Участвовать можно в своём темпе — читать публикации,
            задавать вопросы, делиться впечатлениями или начинать обсуждения.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-playfair text-xl font-bold text-emerald-dark">
            Что можно найти на сайте
          </h2>
          <p>
            В <Link href="/books" className="text-wine underline underline-offset-2">каталоге книг</Link>
            {' '}можно просматривать произведения и переходить к связанным с ними публикациям.
            В <Link href="/posts" className="text-wine underline underline-offset-2">публикациях</Link>
            {' '}читатели делятся отзывами и мыслями о прочитанном, а в
            {' '}<Link href="/discussions" className="text-wine underline underline-offset-2">обсуждениях</Link>
            {' '}обмениваются мнениями. Для собственных рассказов, стихов и эссе есть
            {' '}раздел <Link href="/creative" className="text-wine underline underline-offset-2">творчества</Link>.
          </p>
        </section>

        <section>
          <h2 className="mb-2 font-playfair text-xl font-bold text-emerald-dark">
            Как устроено «Хлеба и букв»
          </h2>
          <p>
            Проект соединяет книжный каталог, пользовательские публикации, обсуждения
            и авторское творчество в одном пространстве. Здесь можно просто читать
            материалы других участников или постепенно включаться в жизнь сообщества.
          </p>
        </section>
      </div>
    </main>
  )
}
