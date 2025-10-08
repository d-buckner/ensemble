import * as d3 from 'd3';
import { createSignal, createEffect } from 'solid-js';


interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  suffix?: string;
}

export function AnimatedNumber(props: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = createSignal(props.value);
  let spanRef: HTMLSpanElement | undefined;

  createEffect(() => {
    const target = props.value;

    if (!spanRef) {
      setDisplayValue(target);
      return;
    }

    // Use D3 to animate the number
    d3.select(spanRef)
      .interrupt()
      .transition()
      .duration(500)
      .ease(d3.easeCubicInOut)
      .tween('number', () => {
        const interpolator = d3.interpolateNumber(displayValue(), target);
        return (t: number) => {
          setDisplayValue(interpolator(t));
        };
      });
  });

  return (
    <span ref={spanRef}>
      {displayValue().toFixed(props.decimals ?? 0)}{props.suffix || ''}
    </span>
  );
}
