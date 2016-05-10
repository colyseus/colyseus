const Clock = require('clock.js')

const lerp = require('lerp')

const MAX_HISTORY_SNAPSHOTS = 10

class Timeline {

  constructor () {

    Object.defineProperty(this, "clock", { writable: true, enumerable: false })
    this.clock = new Clock()

    Object.defineProperty(this, "lastSnapshotTime", { writable: true, enumerable: false })
    this.lastSnapshotTime = -1

    Object.defineProperty(this, "history", { writable: true, enumerable: false })
    this.history = []

  }

  start () {

    this.clock.start()
    this.takeSnapshot ()

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
   * Get snapshot taken at `elapsedTime` interval.
   */
  at ( elapsedTimeAt, interpolate ) {

    if ( typeof( interpolate ) === "undefined" ) {
      interpolate = true
    }

    let i = this.history.length

    let lesserDistance = Infinity
    let lesserDistanceIndex = 0

    while ( i-- ) {

      let frame = this.history[ i ]
      let start = ( frame.end - frame.start )

      let distance = Math.sqrt(
        Math.pow( ( start / 2 ) - ( ( start + elapsedTimeAt - frame.end ) / 2 ), 2 )
      )

      if ( distance < lesserDistance ) {
        lesserDistance = distance
        lesserDistanceIndex = i
      }

    }

    let frame = this.history[ lesserDistanceIndex ]
    let data = JSON.parse( frame.data )

    //
    // traverse all properties to interpolate / extrapolate numbers
    //
    if ( interpolate && elapsedTimeAt !== frame.start ) {

      let multiplier = ( elapsedTimeAt - frame.start ) / ( frame.end - frame.start )
      let previousState = this.at( frame.start - 1, false )
      // this.history[ lesserDistanceIndex - 1 ]

      this.traverseInterpolate( data, previousState, multiplier )

    }

    return data

  }

  traverseInterpolate ( state, previousState, multiplier ) {

    for ( let prop in state  ) {

      let propType = typeof( state[ prop ] )

      if ( propType === "number" ) {

        state[ prop ] = state[prop] + ( previousState[ prop ] - state[ prop ] ) * multiplier

      } else if ( propType === "object" || propType === "array" ) {

        this.traverseInterpolate( state[ prop ], previousState[ prop ], multiplier )

      }

    }

  }

}

module.exports = Timeline
