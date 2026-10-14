/** Give the image model a visual subject, rather than article text describing software UI. */
export function defaultImageBrief(title: string, topic: string) {
  if (
    /software|subscription|crm|consolidat|platform|tool.*(?:cost|overlap|stack)/i.test(
      `${title} ${topic}`,
    )
  )
    return "A physical still life representing accumulated tools becoming simpler: several unmarked boxes and loosely tangled cables on one side, one organized tray with neatly arranged cables on the other. Natural materials, a clear focal point and generous negative space. No computers, screens, printed paper, labels, app icons, diagrams or currency.";
  return "Choose a concrete physical subject or natural scene that expresses the article's central idea. Use unbranded objects, natural materials and a clear focal point. Keep objects free of labels or printing. Avoid screens, app icons, signage, documents, interfaces, charts and diagrams. Communicate through the scene, not written information.";
}
