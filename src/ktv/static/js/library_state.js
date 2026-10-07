export function isPendingVideo(item) {
  return item?.processed_at === 0 && !item.error;
}

export function isFailedVideo(item) {
  return item?.processed_at === 0 && Boolean(item.error);
}

export function getLibraryCardState(item) {
  const pending = isPendingVideo(item);
  const failed = isFailedVideo(item);
  return {
    pending,
    failed,
    playable: !pending && !failed,
    statusLabel: pending ? '處理中' : failed ? '失敗・點擊重試' : '',
  };
}
