export function isPendingVideo(item) {
  return item?.processed_at === 0;
}

export function getLibraryCardState(item) {
  const pending = isPendingVideo(item);
  return {
    pending,
    playable: !pending,
    statusLabel: pending ? '處理中' : '',
  };
}
