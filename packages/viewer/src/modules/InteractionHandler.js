import * as THREE from 'three'
import SectionBox2 from './SectionBox2'
import SelectionHelper from './SelectionHelper'

export default class InteractionHandler {

  constructor( viewer ) {
    this.viewer = viewer

    this.sectionBox = new SectionBox2( this.viewer )
    this.sectionBox.toggle() // switch off

    this.preventSelection = false

    this.selectionHelper = new SelectionHelper( this.viewer, this.viewer.sceneManager.userObjects )
    this.selectionMaterial = new THREE.MeshLambertMaterial( { color: 0x0B55D2, emissive: 0x0B55D2, side: THREE.DoubleSide } )
    this.selectionMaterial.clippingPlanes = this.sectionBox.planes
    this.selectionEdgesMaterial = new THREE.LineBasicMaterial( { color: 0x23F3BD } )
    this.selectionEdgesMaterial.clippingPlanes = this.sectionBox.planes

    this.selectedObjects = new THREE.Group()
    this.viewer.scene.add( this.selectedObjects )
    this.selectedObjects.renderOrder = 1000

    this.selectionHelper.on( 'object-doubleclicked', this._handleDoubleClick.bind( this ) )
    this.selectionHelper.on( 'object-clicked', this._handleSelect.bind( this ) )

  }

  _handleDoubleClick( objs ) {
    if ( !objs || objs.length === 0 ) this.viewer.sceneManager.zoomExtents()
    else this.viewer.sceneManager.zoomToObject( objs[0].object )
    this.viewer.needsRender = true
  }

  _handleSelect( obj ) {
    if ( this.preventSelection ) return

    if ( obj.length === 0 ) {
      this.deselectObjects()
      return
    }

    if ( !this.selectionHelper.multiSelect ) this.deselectObjects()

    let mesh = new THREE.Mesh( obj[0].object.geometry, this.selectionMaterial )
    this.selectedObjects.add( mesh )
    this.viewer.needsRender = true
  }

  deselectObjects() {
    this.selectedObjects.clear()
    this.viewer.needsRender = true
  }

  toggleSectionBox() {
    this.sectionBox.toggle()
    if ( this.sectionBox.display.visible ) {
      this.sectionBox.setBox( this.viewer.sceneManager.getSceneBoundingBox() )
    }
    this.viewer.needsRender = true
  }

  test() {
    this.toggleSectionBox()
    // let tt = new SectionBox2( this.viewer )
  }
}
