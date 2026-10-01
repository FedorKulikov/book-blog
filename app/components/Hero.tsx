type HeroProps = {
  title: string
  subtitle: string
  image: string
}

export default function Hero({ title, subtitle, image }: HeroProps) {
  return (
    <div className="relative rounded-xl overflow-hidden mb-6 h-56 md:h-64">
      {/* Картинка */}
      <img
        src={image}
        alt={title}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Затемнение */}
      <div className="absolute inset-0 bg-gradient-to-t from-emerald-dark/90 via-emerald-dark/50 to-transparent" />
      {/* Текст поверх */}
      <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
        <h1 className="text-3xl md:text-5xl font-bold text-cream">
          {title}
        </h1>
        <p className="text-cream/80 mt-2 text-sm md:text-base">
          {subtitle}
        </p>
      </div>
    </div>
  )
}