export const CARD_WIDTH = 460
export const CARD_HEIGHT = 360
export const CARD_GAP_X = 32
export const CARD_GAP_Y = 48
export const SECTION_GAP = 96
export const CANVAS_PADDING = 80
export const SECTION_HEADER = 70

function versionNumber(version) {
  return Number.isFinite(version.number) ? version.number : 1
}

function intersects(a, b, padding = 0) {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  )
}

function sortedSections(review) {
  return [...(review.sections ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.title.localeCompare(right.title))
}

function pagesOfSection(review, sectionId) {
  return (review.pages ?? [])
    .filter((page) => page.sectionId === sectionId)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.title.localeCompare(right.title))
}

function variantsOfPage(review, pageId) {
  return (review.variants ?? [])
    .filter((variant) => variant.pageId === pageId)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.name.localeCompare(right.name))
}

function versionsOfVariant(review, variantId) {
  return (review.versions ?? [])
    .filter((version) => version.variantId === variantId)
    .sort((left, right) => versionNumber(left) - versionNumber(right))
}

/** Compute deterministic default positions while preserving locked cards. */
export function computeLayout(review) {
  const previous = review.layout ?? {}
  const locked = []
  const layout = {}
  let currentY = CANVAS_PADDING

  for (const section of sortedSections(review)) {
    const sectionTop = currentY
    let pageOffset = 0
    let sectionRight = CANVAS_PADDING + CARD_WIDTH
    for (const page of pagesOfSection(review, section.id)) {
      const variants = variantsOfPage(review, page.id)
      let variantOffset = 0
      for (const variant of variants) {
        const versions = versionsOfVariant(review, variant.id)
        for (const version of versions) {
          const fallback = {
            x: CANVAS_PADDING + pageOffset + variantOffset,
            y: sectionTop + SECTION_HEADER + (versionNumber(version) - 1) * (CARD_HEIGHT + CARD_GAP_Y),
            w: CARD_WIDTH,
            h: CARD_HEIGHT,
            locked: false,
          }
          const prior = previous[version.id]
          if (prior?.locked === true) {
            const lockedCard = {
              x: Number(prior.x) || fallback.x,
              y: Number(prior.y) || fallback.y,
              w: Number(prior.w) || CARD_WIDTH,
              h: Number(prior.h) || CARD_HEIGHT,
              locked: true,
            }
            layout[version.id] = lockedCard
            locked.push(lockedCard)
          } else {
            layout[version.id] = fallback
          }
          sectionRight = Math.max(sectionRight, fallback.x + CARD_WIDTH)
        }
        variantOffset += CARD_WIDTH + CARD_GAP_X
      }
      if (variants.length > 0) {
        pageOffset += variants.length * (CARD_WIDTH + CARD_GAP_X)
      }
    }

    // Keep the grid, but move unlocked cards out of any locked card's way.
    const sectionVersions = Object.entries(layout).filter(([id]) => {
      const version = review.versions.find((entry) => entry.id === id)
      const page = version ? review.pages.find((entry) => entry.id === version.pageId) : undefined
      return page?.sectionId === section.id && layout[id].locked !== true
    })
    const occupied = locked.filter((card) => {
      const version = review.versions.find((entry) => layout[entry.id] === card)
      const page = version ? review.pages.find((entry) => entry.id === version.pageId) : undefined
      return page?.sectionId === section.id
    })
    for (const [id, card] of sectionVersions) {
      let guard = 0
      while (occupied.some((other) => intersects(card, other, 10)) && guard < 80) {
        card.y += CARD_HEIGHT + CARD_GAP_Y
        guard += 1
      }
      occupied.push(card)
      layout[id] = card
    }

    const sectionCards = Object.entries(layout)
      .filter(([id]) => {
        const version = review.versions.find((entry) => entry.id === id)
        const page = version ? review.pages.find((entry) => entry.id === version.pageId) : undefined
        return page?.sectionId === section.id
      })
      .map(([, card]) => card)
    const bottom = sectionCards.length === 0
      ? sectionTop + 220
      : Math.max(...sectionCards.map((card) => card.y + card.h))
    const left = sectionCards.length === 0 ? CANVAS_PADDING : Math.min(...sectionCards.map((card) => card.x))
    const right = sectionCards.length === 0 ? CANVAS_PADDING + 720 : Math.max(...sectionCards.map((card) => card.x + card.w))
    section.bounds = {
      x: Math.max(24, left - 28),
      y: sectionTop - 22,
      w: right - left + 56,
      h: bottom - sectionTop + 50,
    }
    currentY = bottom + SECTION_GAP
  }

  review.layout = layout
  return { layout, sections: sortedSections(review) }
}

export function fitLayout(review) {
  const cards = Object.values(review.layout ?? {})
  if (cards.length === 0) {
    return { x: 0, y: 0, width: 1200, height: 800 }
  }
  const minX = Math.min(...cards.map((card) => card.x))
  const minY = Math.min(...cards.map((card) => card.y))
  const maxX = Math.max(...cards.map((card) => card.x + card.w))
  const maxY = Math.max(...cards.map((card) => card.y + card.h))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
