import { useState } from 'react'
import { useHistoryQuery, useRankingQuery } from '../../api/queries'
import {
  configFingerprint,
  LOCAL_PLAYER_ID,
  type PaginatedResponse,
} from '../../api/types'
import { loadGameOptions } from '../../persistence/gameOptionsStorage'
import { formatRemainingTime } from '../format'

/**
 * The two Main Menu boards. Both consume the mocked REST API through
 * Axios + TanStack Query and render the full state set: loading, error
 * (with retry), empty, list and pagination.
 */

interface PaginationProps {
  page: number
  totalPages: number
  onPage: (page: number) => void
}

function Pagination({ page, totalPages, onPage }: PaginationProps) {
  return (
    <div className="board-pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  )
}

interface BoardErrorProps {
  message: string
  onRetry: () => void
}

function BoardError({ message, onRetry }: BoardErrorProps) {
  return (
    <div role="alert" className="board-error">
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

function clampPage<T>(data: PaginatedResponse<T>, page: number, onPage: (page: number) => void) {
  // After a reset/invalidation the requested page may no longer exist;
  // the server already clamps, keep the local state in sync with it.
  if (data.page !== page) onPage(data.page)
}

export function RankingPanel() {
  // The ranking compares matches played under the SAME exposed options;
  // the board shows the leaderboard for the currently saved options.
  const [options] = useState(loadGameOptions)
  const [page, setPage] = useState(1)
  const query = useRankingQuery(configFingerprint(options), page)

  if (query.isPending) return <p role="status">Loading ranking…</p>
  if (query.isError) {
    return <BoardError message="Could not load the ranking." onRetry={() => void query.refetch()} />
  }
  const data = query.data
  // keepPreviousData shows the old page while the new one loads; only a
  // SETTLED response may clamp the local page state.
  if (!query.isPlaceholderData) clampPage(data, page, setPage)
  if (data.totalItems === 0) {
    return <p>No matches recorded for these game options yet. Finish a battle to claim a spot!</p>
  }
  return (
    <>
      <p className="board-note">
        Best score per captain · {options.sessionDurationSeconds}s session /{' '}
        {options.enemySpawnIntervalSeconds}s spawns
      </p>
      <ol className="board-list">
        {data.items.map((entry) => (
          <li key={entry.playerId}>
            <span className="board-list__rank">#{entry.rank}</span>
            <span className="board-list__name">{entry.playerName}</span>
            <span className="board-list__score">{entry.score} pts</span>
          </li>
        ))}
      </ol>
      <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
    </>
  )
}

export function HistoryPanel() {
  const [page, setPage] = useState(1)
  const query = useHistoryQuery(LOCAL_PLAYER_ID, page)

  if (query.isPending) return <p role="status">Loading match history…</p>
  if (query.isError) {
    return (
      <BoardError
        message="Could not load your match history."
        onRetry={() => void query.refetch()}
      />
    )
  }
  const data = query.data
  if (!query.isPlaceholderData) clampPage(data, page, setPage)
  if (data.totalItems === 0) {
    return <p>You have not completed any matches yet.</p>
  }
  return (
    <>
      <ul className="board-list board-list--history">
        {data.items.map((match) => (
          <li key={match.matchId}>
            <span className="board-list__date">
              {new Date(match.completedAt).toLocaleDateString()}
            </span>
            <span className="board-list__name">
              {match.endReason === 'player-death' ? 'Defeated' : 'Time expired'} ·{' '}
              {formatRemainingTime(match.durationPlayedSeconds)} played
            </span>
            <span className="board-list__score">{match.score} pts</span>
          </li>
        ))}
      </ul>
      <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
    </>
  )
}
