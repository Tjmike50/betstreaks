import { useState, useCallback, useEffect } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Button } from "@/components/ui/button";
import { TrendingUp, Star, Bell } from "lucide-react";

interface OnboardingFlowProps {
  onComplete: () => void;
}

const slides = [
  {
    title: "Track what keeps hitting",
    body: "We track NBA player & team streaks that are actively hitting — updated daily.",
    icon: TrendingUp,
    color: "text-primary",
    bgColor: "bg-primary/20",
  },
  {
    title: "Save your picks",
    body: "Tap ⭐ to save streaks to your Watchlist. Get alerts when streaks extend or break.",
    icon: Star,
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/20",
  },
  {
    title: "Stay ahead",
    body: "Alerts show what changed today so you don't have to check everything.",
    icon: Bell,
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/20",
  },
];

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollTo = useCallback(
    (index: number) => emblaApi && emblaApi.scrollTo(index),
    [emblaApi]
  );

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    onSelect();
  }, [emblaApi, onSelect]);

  const isLastSlide = selectedIndex === slides.length - 1;

  const handleNext = () => {
    if (isLastSlide) {
      onComplete();
    } else {
      scrollTo(selectedIndex + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Skip button */}
      <div className="absolute top-4 right-4 z-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={onComplete}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip
        </Button>
      </div>

      {/* Carousel */}
      <div className="flex-1 overflow-hidden" ref={emblaRef}>
        <div className="flex h-full">
          {slides.map((slide, index) => {
            const Icon = slide.icon;
            return (
              <div
                key={index}
                className="flex-[0_0_100%] min-w-0 h-full flex flex-col items-center justify-center px-8 text-center"
              >
                {/* Icon */}
                <div
                  className={`w-24 h-24 rounded-full ${slide.bgColor} flex items-center justify-center mb-8 animate-scale-in`}
                >
                  <Icon className={`w-12 h-12 ${slide.color}`} />
                </div>

                {/* Title */}
                <h1 className="text-2xl font-bold text-foreground mb-4">
                  {slide.title}
                </h1>

                {/* Body */}
                <p className="text-base text-muted-foreground max-w-xs leading-relaxed">
                  {slide.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom section: dots + button */}
      <div className="px-8 pb-12 pt-4 space-y-6">
        {/* Dots indicator */}
        <div className="flex justify-center gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === selectedIndex
                  ? "w-6 bg-primary"
                  : "bg-muted-foreground/30"
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>

        {/* Action button */}
        <Button
          onClick={handleNext}
          className="w-full"
          size="lg"
        >
          {isLastSlide ? "Get Started" : "Next"}
        </Button>
      </div>
    </div>
  );
}
