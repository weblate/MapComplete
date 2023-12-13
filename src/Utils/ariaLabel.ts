import { Translation } from "../UI/i18n/Translation"

export function ariaLabel(htmlElement: Element, t: Translation) {
    let destroy: () => void = undefined

    t.current.map(
        (label) => {
            htmlElement.setAttribute("aria-label", label)
        },
        [],
        (f) => {
            destroy = f
        }
    )

    return { destroy }
}
