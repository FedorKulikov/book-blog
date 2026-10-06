type HeroProps = {
  title: string
  subtitle: string
  image: string
}

export default function Hero({ title, subtitle, image }: HeroProps) {
  return (
    <div className="relative rounded-2xl overflow-hidden mb-5 h-44 sm:h-52 md:h-56">
      <img
        src={image}
        alt={title}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-emerald-dark via-emerald-dark/60 to-emerald-dark/15" />
      <div className="relative h-full flex flex-col justify-end p-5 md:p-8">
        <h1 className="font-playfair text-2xl sm:text-3xl md:text-5xl font-bold text-cream leading-tight">
          {title}
        </h1>
        <p className="text-cream/70 mt-2 text-xs md:text-sm max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      </div>
    </div>
  )
}