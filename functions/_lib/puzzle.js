// D1 satırını oyuncunun beklediği yüke (payload) çevirir.
export function rowToPayload(row) {
  return {
    date: row.puzzle_date,
    no: row.no,
    title: row.title,
    solution: JSON.parse(row.solution),
    clues: JSON.parse(row.clues)
  };
}
