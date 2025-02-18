'use strict'
const zlib = require( 'zlib' )
const cors = require( 'cors' )
const Busboy = require( 'busboy' )
const debug = require( 'debug' )
const appRoot = require( 'app-root-path' )

const { matomoMiddleware } = require( `${appRoot}/logging/matomoHelper` )
const { contextMiddleware } = require( `${appRoot}/modules/shared` )
const { validatePermissionsWriteStream } = require( './authUtils' )

const { createObjects, createObjectsBatched } = require( '../services/objects' )

const MAX_FILE_SIZE = 50 * 1024 * 1024

module.exports = ( app ) => {
  app.options( '/objects/:streamId', cors() ) 
  
  app.post( '/objects/:streamId', cors(), contextMiddleware, matomoMiddleware, async ( req, res ) => {
    let hasStreamAccess = await validatePermissionsWriteStream( req.params.streamId, req )
    if ( !hasStreamAccess.result ) {
      return res.status( hasStreamAccess.status ).end()
    }

    let busboy = Busboy( { headers: req.headers } )
    let totalProcessed = 0
    let last = {}

    let promises = [ ]
    let requestDropped = false

    busboy.on( 'file', ( name, file, info ) => {
      const { filename, encoding, mimeType } = info

      if ( requestDropped ) return

      if ( mimeType === 'application/gzip' ) {
        let buffer = [ ]

        file.on( 'data', ( data ) => {
          if ( data ) buffer.push( data )
        } )

        file.on( 'end', async ( ) => {
          if ( requestDropped ) return
          let t0 = Date.now()
          let objs = [ ]

          let gzippedBuffer = Buffer.concat( buffer )
          if ( gzippedBuffer.length > MAX_FILE_SIZE ) {
            debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Upload error: Batch size too large (${gzippedBuffer.length} > ${MAX_FILE_SIZE})` )
            if ( !requestDropped ) res.status( 400 ).send( `File size too large (${gzippedBuffer.length} > ${MAX_FILE_SIZE})` )
            requestDropped = true
          }

          let gunzippedBuffer = zlib.gunzipSync( gzippedBuffer ).toString( )
          if ( gunzippedBuffer.length > MAX_FILE_SIZE ) {
            debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Upload error: Batch size too large (${gunzippedBuffer.length} > ${MAX_FILE_SIZE})` )
            if ( !requestDropped ) res.status( 400 ).send( `File size too large (${gunzippedBuffer.length} > ${MAX_FILE_SIZE})` )
            requestDropped = true
          }

          try {
            objs = JSON.parse( gunzippedBuffer )
          } catch ( e ) {
            debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Upload error: Batch not in JSON format` )
            if ( !requestDropped ) res.status( 400 ).send( 'Failed to parse data.' )
            requestDropped = true
          }

          last = objs[ objs.length - 1 ]
          totalProcessed += objs.length

          let promise = createObjectsBatched( req.params.streamId, objs ).catch( e => {
            debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Upload error: ${e.message}` )
            if ( !requestDropped ) res.status( 400 ).send( 'Error inserting object in the database. Check server logs for details' )
            requestDropped = true
          } )
          promises.push( promise )

          await promise

          debug( 'speckle:info' )( `[User ${req.context.userId || '-'}] Uploaded batch of ${objs.length} objects to stream ${req.params.streamId} (size: ${gunzippedBuffer.length / 1000000} MB, duration: ${( Date.now() - t0 ) / 1000}s, crtMemUsage: ${process.memoryUsage( ).heapUsed / 1024 / 1024} MB, dropped=${requestDropped})` )
        } )
      } else if ( mimeType === 'text/plain' || mimeType === 'application/json' || mimeType === 'application/octet-stream' ) {
        let buffer = ''

        file.on( 'data', ( data ) => {
          if ( data ) buffer += data
        } )

        file.on( 'end', async ( ) => {
          if ( requestDropped ) return
          let t0 = Date.now()
          let objs = [ ]

          if ( buffer.length > MAX_FILE_SIZE ) {
            debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Upload error: Batch size too large (${buffer.length} > ${MAX_FILE_SIZE})` )
            if ( !requestDropped ) res.status( 400 ).send( `File size too large (${buffer.length} > ${MAX_FILE_SIZE})` )
            requestDropped = true
          }

          try {
            objs = JSON.parse( buffer )
          } catch ( e ) {
            debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Upload error: Batch not in JSON format` )
            if ( !requestDropped ) res.status( 400 ).send( 'Failed to parse data.' )
            requestDropped = true
          }
          last = objs[ objs.length - 1 ]
          totalProcessed += objs.length

          let promise = createObjectsBatched( req.params.streamId, objs ).catch( e => {
            debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Upload error: ${e.message}` )
            if ( !requestDropped ) res.status( 400 ).send( 'Error inserting object in the database. Check server logs for details' )
            requestDropped = true
          } )
          promises.push( promise )

          await promise
          debug( 'speckle:info' )( `[User ${req.context.userId || '-'}] Uploaded batch of ${objs.length} objects to stream ${req.params.streamId} (size: ${buffer.length / 1000000} MB, duration: ${( Date.now() - t0 ) / 1000}s, crtMemUsage: ${process.memoryUsage( ).heapUsed / 1024 / 1024} MB, dropped=${requestDropped})` )
        } )
      } else {
        debug( 'speckle:error' )( `[User ${req.context.userId || '-'}] Invalid ContentType header: ${mimeType}` )
        if ( !requestDropped ) res.status( 400 ).send( 'Invalid ContentType header. This route only accepts "application/gzip", "text/plain" or "application/json".' )
        requestDropped = true
      }
    } )

    busboy.on( 'finish', async ( ) => {
      if ( requestDropped ) return

      debug( 'speckle:upload-endpoint' )( `[User ${req.context.userId || '-'}] Upload finished: ${totalProcessed} objs, ${process.memoryUsage( ).heapUsed / 1024 / 1024} MB mem` )

      await Promise.all( promises )

      res.status( 201 ).end( )
    } )

    req.pipe( busboy )
  } )
}
