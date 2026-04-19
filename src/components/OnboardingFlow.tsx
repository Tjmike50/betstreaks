import { useState, useCallback, useEffect } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Button } from "@/components/ui/button";
import { Flame, Brain, Crown } from "lucide-react";

interface OnboardingFlowProps {
  onComplete: () => void;
}

const slides = [
  {
    title: "Streaks That Hit 🏀",
    body: "Track active player & team prop streaks across the NBA and WNBA — updated daily with real game data.",
    icon: Flame,
    color: "text-primary",
    bgColor: "bg-primary/20",
  },
  {
    title: "AI-Powered Slips",
    body: "Our AI analyzes matchups, hit rates, and streaks to build data-driven parlays instantly.",
    icon: Brain,
    color: "text-primary",
    bgColor: "bg-primary/20",
  },
  {
    title: "Get the Playoff Pass",
    body: "Full NBA Playoff access through the Finals — $25. Promo codes accepted at checkout.",
    icon: Crown,
    color: "text-amber-400",
    bgColor: "bg-amber-400/20",
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
                <div
                  className={`w-20 h-20 rounded-full ${slide.bgColor} flex items-center justify-center mb-6`}
                >
                  <Icon className={`w-10 h-10 ${slide.color}`} />
                </div>

                <h1 className="text-2xl font-bold text-foreground mb-3">
                  {slide.title}
                </h1>

                <p className="text-base text-muted-foreground max-w-xs leading-relaxed">
                  {slide.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom section */}
      <div className="px-8 pb-24 pt-4 space-y-6">
        <div className="flex justify-center gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollTo(index)}
              className={`h-2 rounded-full transition-all duration-300 ${
                index === selectedIndex
                  ? "w-6 bg-primary"
                  : "w-2 bg-muted-foreground/30"
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>

        <Button onClick={handleNext} className="w-full" size="lg">
          {isLastSlide ? "Get Started" : "Next"}
        </Button>
      </div>
    </div>
  );
}
