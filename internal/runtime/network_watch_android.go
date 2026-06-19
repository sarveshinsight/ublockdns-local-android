//go:build android
// +build android

package runtime

import (
	"context"
)

var watchNetworkChanges = defaultWatchNetworkChanges

func defaultWatchNetworkChanges(ctx context.Context, changes chan<- string) {
	// Disable network polling on Android to save battery (BAT-10)
	<-ctx.Done()
}
