const Clock = require('clock.js')

const lerp = require('lerp')

const MAX_HISTORY_SNAPSHOTS = 10

class Timeline {

  constructor () {

    Object.defineProperty(this, "clock", { writable: true, enumerable: false })
    this.clock = new Clock()

    Object.defineProperty(this, "lastSnapshotTime", { writable: true, enumerable: false })
    this.lastSnapshotTime = 0

    Object.defineProperty(this, "history", { writable: true, enumerable: false })
    this.history = []

  }

  start () {

    this.clock.start()
    this.takeSnapshot ()

  }

  extrapolate ( value, time ) {
  }

  interpolate ( value, time ) {
  }

  takeSnapshot () {

    //
    // history timeframe:
    //
    // { "start": 0, "end": 1000, "data": {} }
    //
    this.history.push( {
      start: this.lastSnapshotTime,
      end: this.clock.elapsedTime,
      data: JSON.stringify( this )
    } )

    // drop older history
    if ( this.history.length > MAX_HISTORY_SNAPSHOTS ) {
      this.history.unshift()
    }

    this.lastSnapshotTime = this.clock.elapsedTime

  }

  /**
   * Get snapshot taken at `offset` time.
   */
  getSnapshotAt ( elapsedTimeAt, interpolate = true ) {

    let i = this.history.length
      , data = null

    while ( i-- ) {

      let endTime = this.history[ i ].end
        , startTime = this.history[ i ].start

      if ( elapsedTimeAt >= startTime  && elapsedTimeAt <= endTime ) {

        let multiplier = ( elapsedTimeAt - startTime ) / ( endTime - startTime )
        data = JSON.parse( this.history[ i ].data )

        //
        // traverse all properties to interpolate / extrapolate numbers
        //
        if ( interpolate ) {

          let previousState = this.getSnapshotAt( startTime - 1, false )
          let nextState = this.getSnapshotAt( endTime + 1, false )

          this.traverseInterpolate( data, previousState, nextState, multiplier )

        }

        break

      }

    }

    return data

  }

  traverseInterpolate ( state, previousState, nextState, multiplier ) {

    for ( let prop in state  ) {

      let propType = typeof( state[ prop ] )

      if ( propType === "number" ) {

        state[ prop ] = state[ prop ]

      } else if ( propType === "object" || propType === "array" ) {

        this.traverseInterpolate( state[ prop ], multiplier )

      }

    }

  }

}

module.exports = Timeline
