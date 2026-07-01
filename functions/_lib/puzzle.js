// D1 satırını oyuncunun beklediği yüke (payload) çevirir.
export function rowToPayload(row) {
  const clues = JSON.parse(row.clues);
  const media = Array.isArray(clues && clues.__media) ? clues.__media : [];
  if (clues && Object.prototype.hasOwnProperty.call(clues, "__media")) delete clues.__media;
  return {
    date: row.puzzle_date,
    no: row.no,
    title: row.title,
    solution: JSON.parse(row.solution),
    clues,
    media
  };
}
