# Braccato Animation Engine Quirks

## The CSS Transition Race Condition
Themes (like GlassyFlow or `mergetheme.js`) rely heavily on CSS transitions with dynamic delays:
```css
transition: opacity 0.7s ease calc(var(--blyrics-anim-delay, 0s) - 0.3s)
```

The Braccato engine manages the timing of these animations by adding an `ANIMATING_CLASS` (`blyrics--animating`) to a lyric line when it's time to animate (usually 2 seconds before the lyric is sung).

### The Bug
If you try to react to the `ANIMATING_CLASS` being added using a `MutationObserver` to inject the `--blyrics-anim-delay` variable, the CSS transition will fire prematurely. 
This happens because Braccato's engine evaluates `mainView.tick()` inside a `requestAnimationFrame` callback. Immediately after the class is added, the engine queries DOM timings (like `animation.currentTime`), which forces a **synchronous style recalculation**. 
At this moment, the `MutationObserver` microtask hasn't run yet, so the CSS variable defaults to `0s`, triggering the transition immediately.

### The Solution (GlassyFlow Bridge)
To avoid this race condition, CSS timing variables MUST be pre-calculated and applied to the DOM *before* Braccato's engine adds the `ANIMATING_CLASS`.

This is achieved by **monkeypatching `mainView.tick`**:
1. Intercept `mainView.tick`.
2. Determine the exact `actualTime` Braccato will use (accounting for all offsets like `--blyrics-richsync-timing-offset` and `lineOffsetTrim`).
3. Iterate over `mainView.lines` and look ahead ~4 seconds for lines that do *not* yet have the `ANIMATING_CLASS`.
4. Pre-apply `--blyrics-swipe-delay` and `--blyrics-anim-delay` to those upcoming line components.
5. Invoke the original `tick` function. When Braccato synchronously adds `ANIMATING_CLASS` and forces a layout, the CSS variables are already flawlessly in place.

## The Proxy Scroll Interception Pitfall
Some custom themes (like GlassyFlow's spring scroll) disable native WAAPI scrolling (`--blyrics-animate-scroll: 0`) and rely on a **FLIP animation hack** where `lyricsElement.style.transform` is counter-translated *before* the container's `scrollTop` is updated. 

Because `@braccato/core` does not have this hack built-in, you must intercept the `getScrollElement()` host method.

### The Bug
If you wrap the scroll container in a JavaScript `Proxy` to intercept `scrollTop` assignments:
```typescript
const proxy = new Proxy(el, { ... });
```
You will break native DOM APIs! When the engine passes this `Proxy` to native methods like `ResizeObserver.observe()` or event listeners, the browser throws:
- `TypeError: Illegal invocation`
- `TypeError: Failed to execute 'observe' on 'ResizeObserver': parameter 1 is not of type 'Element'.`

Native browser C++ bindings strictly require a real `Element` pointer, which a `Proxy` masks.

### The Solution
Instead of returning a `Proxy`, use `Object.defineProperty` to shadow the `scrollTop` property on the exact `HTMLElement` instance, falling back to `Element.prototype`:

```typescript
const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
Object.defineProperty(el, "scrollTop", {
  get() { return originalDescriptor.get.call(this); },
  set(value) {
    // 1. FLIP scroll hack here
    // ...
    // 2. Pass through
    return originalDescriptor.set.call(this, value);
  }
});
```
This preserves the element's 100% native DOM identity, allowing `ResizeObserver` to work perfectly while still intercepting all scroll updates.
